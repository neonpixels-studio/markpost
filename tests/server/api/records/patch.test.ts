import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const updateMock = vi.fn();
const selectMock = vi.fn();
const writeEventMock = vi.fn(() => Promise.resolve());

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ update: updateMock, select: selectMock }),
}));

vi.mock("../../../../server/utils/eventWriter", () => ({
  writeEvent: writeEventMock,
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();
const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/records/[uuid].patch");

const userId = "user_abc123";
const validUuid = "3f607385-96d5-4144-8387-9590afbb7d62";

const sampleRecord = {
  uuid: validUuid,
  userId,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  title: "My Note",
  content: "Some content",
  sourceId: null,
  source: null,
  status: "error",
  filePath: null,
  tags: null,
  frontmatter: null,
  syncedAt: null,
  errorMessage: "Sync failed",
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(attributes: Record<string, unknown>) {
  return { data: { type: "records", attributes } };
}

function stubUpdateResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where, returning };
}

// The handler issues up to two db.select() calls in a fixed order: first
// isNoOpSyncedUpdate (skipped entirely unless this request moves status to
// "synced"), then resolveSourceTypes (skipped entirely when the updated
// record has no sourceId). Queue-based so a test can give each call its own
// result instead of one static return shared by both — `results[N]` may be a
// plain row array or a thunk (for rejection).
function stubSelects(results: (unknown[] | (() => Promise<unknown[]>))[]) {
  let call = 0;
  selectMock.mockImplementation(() => {
    const index = call;
    call += 1;
    const resultOrThunk = results[index] ?? [];
    const where = vi.fn(() =>
      typeof resultOrThunk === "function"
        ? resultOrThunk()
        : Promise.resolve(resultOrThunk),
    );
    const from = vi.fn(() => ({ where }));
    return { from };
  });
}

// Convenience for tests that only care about the sourceType lookup: the
// no-op-synced-update call (if any) resolves empty, which doesn't affect
// these sourceType-focused tests.
function stubSourceTypeResult(rows: unknown[]) {
  stubSelects([[], rows]);
}

function existingRecordRow(status: string, syncedAt: Date | null) {
  return { status, syncedAt };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  mockGetRouterParam.mockReset();
  updateMock.mockReset();
  selectMock.mockReset();
  writeEventMock.mockClear();
  stubSelects([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PATCH /api/records/:uuid", () => {
  it("returns the updated record when status, filePath, and errorMessage are provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"));

    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({
        status: "synced",
        filePath: "05-stripe/note.md",
        errorMessage: null,
      }),
    );
    const updatedRecord = {
      ...sampleRecord,
      status: "synced",
      syncedAt: new Date("2026-06-27T12:00:00.000Z"),
      filePath: "05-stripe/note.md",
      errorMessage: null,
    };
    stubUpdateResult([updatedRecord]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        type: "records",
        id: validUuid,
        attributes: {
          uuid: validUuid,
          createdAt: updatedRecord.createdAt,
          userId,
          title: updatedRecord.title,
          content: updatedRecord.content,
          sourceId: null,
          source: null,
          sourceType: null,
          status: "synced",
          filePath: "05-stripe/note.md",
          tags: null,
          frontmatter: null,
          syncedAt: updatedRecord.syncedAt,
          errorMessage: null,
        },
        links: { self: `/api/records/${validUuid}` },
      },
    });
  });

  it("resolves and includes sourceType when the record has a sourceId", async () => {
    const sourceId = "550e8400-e29b-41d4-a716-446655440099";
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
    const updatedRecord = {
      ...sampleRecord,
      sourceId,
      source: "My GitHub hook",
      status: "synced",
    };
    stubUpdateResult([updatedRecord]);
    stubSourceTypeResult([{ uuid: sourceId, type: "github" }]);

    const response = await handler(buildEvent(userId));

    expect(response.data?.attributes.sourceType).toBe("github");
  });

  it("returns sourceType: null (never fails the update) when the type lookup throws", async () => {
    const sourceId = "550e8400-e29b-41d4-a716-446655440099";
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
    const updatedRecord = {
      ...sampleRecord,
      sourceId,
      source: "My GitHub hook",
      status: "synced",
    };
    stubUpdateResult([updatedRecord]);
    // Call 1: isNoOpSyncedUpdate resolves fine. Call 2: resolveSourceTypes
    // rejects — only the sourceType enrichment should degrade, not the update.
    stubSelects([[], () => Promise.reject(new Error("connection reset"))]);

    const response = await handler(buildEvent(userId));

    expect(response.data?.attributes.sourceType).toBeNull();
    expect(response.data?.attributes.status).toBe("synced");
    consoleErrorSpy.mockRestore();
  });

  it("returns 409 when the new filePath collides with another record (23505)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ filePath: "taken/path.md" }));

    const uniqueViolation = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint: "records_user_id_file_path_lower_unique",
    });
    const returning = vi.fn(() => Promise.reject(uniqueViolation));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    updateMock.mockReturnValue({ set });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it("updates only status without touching other fields", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "pending" }));
    const updatedRecord = { ...sampleRecord, status: "pending" };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ status: "pending" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("updates only filePath without touching other fields", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ filePath: "05-stripe/note.md" }),
    );
    const updatedRecord = {
      ...sampleRecord,
      filePath: "05-stripe/note.md",
    };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ filePath: "05-stripe/note.md" });
  });

  it("updates only errorMessage without touching other fields", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ errorMessage: "Retry failed: timeout" }),
    );
    const updatedRecord = {
      ...sampleRecord,
      errorMessage: "Retry failed: timeout",
    };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({
      errorMessage: "Retry failed: timeout",
    });
  });

  it("moves a record from error to synced status, clearing errorMessage and stamping syncedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"));

    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ status: "synced", errorMessage: null }),
    );
    const updatedRecord = {
      ...sampleRecord,
      status: "synced",
      errorMessage: null,
      syncedAt: new Date("2026-06-27T12:00:00.000Z"),
    };
    const { set } = stubUpdateResult([updatedRecord]);

    const response = await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({
      status: "synced",
      errorMessage: null,
      syncedAt: new Date("2026-06-27T12:00:00.000Z"),
    });
    expect(response.data?.attributes.status).toBe("synced");
    expect(response.data?.attributes.errorMessage).toBeNull();
  });

  it("updates title and content, preserving createdAt and source lineage", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ title: "Corrected title", content: "Corrected content" }),
    );
    const updatedRecord = {
      ...sampleRecord,
      title: "Corrected title",
      content: "Corrected content",
    };
    const { set } = stubUpdateResult([updatedRecord]);

    const response = await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({
      title: "Corrected title",
      content: "Corrected content",
    });
    expect(response.data?.attributes.title).toBe("Corrected title");
    expect(response.data?.attributes.content).toBe("Corrected content");
    expect(response.data?.attributes.createdAt).toEqual(sampleRecord.createdAt);
  });

  it("writes an activity event when title or content is edited", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: "Corrected title" }));
    const updatedRecord = { ...sampleRecord, title: "Corrected title" };
    stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        kind: "dim",
        recordUuid: validUuid,
      }),
    );
  });

  it("does not write an activity event for a status/filePath/errorMessage-only update", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
    stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

    await handler(buildEvent(userId));

    expect(writeEventMock).not.toHaveBeenCalled();
  });

  it("does not fail the request when writing the edit event throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: "Corrected title" }));
    stubUpdateResult([{ ...sampleRecord, title: "Corrected title" }]);
    writeEventMock.mockReturnValueOnce(
      Promise.reject(new Error("db unavailable")),
    );

    const response = await handler(buildEvent(userId));

    expect(response.data?.attributes.title).toBe("Corrected title");
    consoleErrorSpy.mockRestore();
  });

  it("updates only title without touching other fields", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: "New title" }));
    const updatedRecord = { ...sampleRecord, title: "New title" };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ title: "New title" });
  });

  it("updates only content without touching other fields", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ content: "New content" }));
    const updatedRecord = { ...sampleRecord, content: "New content" };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ content: "New content" });
  });

  it("trims whitespace from title before persisting", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: "  Padded title  " }));
    const updatedRecord = { ...sampleRecord, title: "Padded title" };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ title: "Padded title" });
  });

  it("allows content to be updated to an empty string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ content: "" }));
    const updatedRecord = { ...sampleRecord, content: "" };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ content: "" });
  });

  it("throws 422 when title is not a string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: 42 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Title must be a non-empty string",
            source: { pointer: "/data/attributes/title" },
          },
        ],
      },
    });
  });

  it("throws 422 when title is null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: null }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it("throws 422 when title is empty or whitespace-only", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ title: "   " }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Title must be a non-empty string",
            source: { pointer: "/data/attributes/title" },
          },
        ],
      },
    });
  });

  it("throws 422 when content is not a string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ content: 42 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Content must be a string",
            source: { pointer: "/data/attributes/content" },
          },
        ],
      },
    });
  });

  it("throws 422 when content is null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ content: null }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it("throws 422 when no updatable fields are provided", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({}));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: { errors: expect.any(Array) },
    });
  });

  it("throws 422 when status is not a recognized value", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "archived" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Status must be one of: synced, pending, error",
            source: { pointer: "/data/attributes/status" },
          },
        ],
      },
    });
  });

  it("throws 422 when attributes is not an object", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue({
      data: { type: "records", attributes: "not-an-object" },
    });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Attributes must be an object.",
            source: { pointer: "/data/attributes" },
          },
        ],
      },
    });
  });

  it("throws 422 when attributes is an array", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue({
      data: { type: "records", attributes: ["status"] },
    });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Attributes must be an object.",
            source: { pointer: "/data/attributes" },
          },
        ],
      },
    });
  });

  it("throws 422 when filePath is not a string or null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ filePath: 42 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "FilePath must be a string or null",
            source: { pointer: "/data/attributes/filePath" },
          },
        ],
      },
    });
  });

  it("throws 422 when errorMessage is not a string or null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ errorMessage: 42 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "ErrorMessage must be a string or null",
            source: { pointer: "/data/attributes/errorMessage" },
          },
        ],
      },
    });
  });

  it("throws 404 when the record does not exist for the user (also covers non-owner access)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
    stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: {
        errors: [
          {
            status: "404",
            title: "Not Found",
            detail: "No record was found for the given uuid.",
          },
        ],
      },
    });
  });

  it("throws 400 when the uuid is malformed", async () => {
    mockGetRouterParam.mockReturnValue("not-a-uuid");
    mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: {
        errors: [
          {
            status: "400",
            title: "Invalid Parameter",
            detail: "The uuid parameter is missing or malformed.",
            source: { parameter: "uuid" },
          },
        ],
      },
    });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);

    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({ status: "401", title: "Unauthorized" }),
        ],
      },
    });
  });

  // Bug: markpost#291 (mirroring markpost#265's fix on the bulk endpoint). A
  // single-record status change let the client dictate syncedAt outright —
  // an arbitrary client-supplied timestamp alongside (or independent of) a
  // status change could corrupt the "synced today" stat card. The client can
  // no longer supply syncedAt at all (see "rejects any client-supplied
  // syncedAt" below); these tests exercise the server-side derivation, which
  // stamps "now" unless doing so would be a true no-op — current status is
  // already "synced" *and* it already has a real syncedAt. Both conditions
  // matter: status alone would wrongly skip a POST-created
  // "synced"-with-no-syncedAt record, and syncedAt alone would wrongly skip a
  // genuine pending/error -> synced re-sync that still has an old syncedAt on
  // the row.
  describe("syncedAt trust boundary on status changes", () => {
    it("does not re-stamp syncedAt when the record is already fully synced", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      stubSelects([
        [existingRecordRow("synced", new Date("2024-01-01T00:00:00Z"))],
      ]);
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({ status: "synced" });
    });

    it("stamps syncedAt with the current time when a record has never been synced", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"));

      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      stubSelects([[existingRecordRow("pending", null)]]);
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({
        status: "synced",
        syncedAt: new Date("2026-06-27T12:00:00.000Z"),
      });
    });

    // Regression case: status alone can't answer "has this ever been
    // synced?" — POST /api/records lets a client create a record already
    // marked "synced" with no syncedAt. Keying the guard off status instead
    // of syncedAt would make such a record permanently unstampable here.
    it("stamps syncedAt even when the record's current status is already synced, as long as syncedAt is null", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      stubSelects([[existingRecordRow("synced", null)]]);
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ syncedAt: expect.any(Date) }),
      );
    });

    // Regression case: syncedAt alone can't answer it either — a record
    // synced weeks ago, then moved to "error", still carries that old
    // syncedAt (this fix no longer nulls it). Re-marking it "synced" today is
    // a genuine new sync and must get a fresh stamp, not be skipped as if it
    // were still the same sync.
    it("re-stamps syncedAt on a genuine re-sync, even though the row still carries an old syncedAt from before", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"));

      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      stubSelects([
        [existingRecordRow("error", new Date("2024-01-01T00:00:00Z"))],
      ]);
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({
        status: "synced",
        syncedAt: new Date("2026-06-27T12:00:00.000Z"),
      });
    });

    it("stamps syncedAt when the server has no prior record of the uuid at all", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      stubSelects([[]]);
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "synced" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ syncedAt: expect.any(Date) }),
      );
    });

    it("never touches syncedAt, and never queries for it, when moving a record to pending", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "pending" }));
      const { set } = stubUpdateResult([
        { ...sampleRecord, status: "pending" },
      ]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({ status: "pending" });
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("never touches syncedAt, and never queries for it, when moving a record to error", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(
        buildBody({ status: "error", errorMessage: "boom" }),
      );
      const { set } = stubUpdateResult([{ ...sampleRecord, status: "error" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({
        status: "error",
        errorMessage: "boom",
      });
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("skips the lookup entirely when the update includes no status change", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ filePath: "a.md" }));
      const { set } = stubUpdateResult([{ ...sampleRecord, filePath: "a.md" }]);

      await handler(buildEvent(userId));

      expect(set).toHaveBeenCalledWith({ filePath: "a.md" });
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("aborts the request, writing nothing, when the no-op lookup fails", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ status: "synced" }));
      // Unlike the sourceType lookup (display-only enrichment, degrades
      // gracefully), a failed lookup here must not fall back to a guess —
      // guessing "not yet synced" would re-stamp the row and reintroduce the
      // exact stat inflation this fix closes.
      stubSelects([() => Promise.reject(new Error("connection reset"))]);

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 500,
      });
      expect(updateMock).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    // Guards against a partial fix that only checks the combination — a
    // standalone `{ syncedAt }` update (no status key at all) is just as much
    // a client-trusted timestamp as one sent alongside a status change, and
    // must be rejected the same way rather than left as an unguarded
    // backdoor around the restriction.
    it("throws 422 when a client sends syncedAt alongside a status change", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(
        buildBody({ status: "synced", syncedAt: "2099-01-01T00:00:00.000Z" }),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            {
              status: "422",
              title: "Invalid Attribute",
              detail:
                "SyncedAt is derived by the server from status changes and cannot be set directly.",
              source: { pointer: "/data/attributes/syncedAt" },
            },
          ],
        },
      });
      expect(updateMock).not.toHaveBeenCalled();
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("throws 422 when a client sends a standalone syncedAt with no status change", async () => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody({ syncedAt: null }));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            {
              status: "422",
              title: "Invalid Attribute",
              detail:
                "SyncedAt is derived by the server from status changes and cannot be set directly.",
              source: { pointer: "/data/attributes/syncedAt" },
            },
          ],
        },
      });
      expect(updateMock).not.toHaveBeenCalled();
      expect(selectMock).not.toHaveBeenCalled();
    });
  });
});
