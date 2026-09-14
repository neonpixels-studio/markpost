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

function stubSourceTypeResult(rows: unknown[]) {
  const where = vi.fn(() => Promise.resolve(rows));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where };
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PATCH /api/records/:uuid", () => {
  it("returns the updated record when status, syncedAt, filePath, and errorMessage are provided", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({
        status: "synced",
        syncedAt: "2024-01-16T10:00:00.000Z",
        filePath: "05-stripe/note.md",
        errorMessage: null,
      }),
    );
    const updatedRecord = {
      ...sampleRecord,
      status: "synced",
      syncedAt: new Date("2024-01-16T10:00:00.000Z"),
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
    const where = vi.fn(() => Promise.reject(new Error("connection reset")));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });

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

  it("moves a record from error to synced status, clearing errorMessage", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ status: "synced", errorMessage: null }),
    );
    const updatedRecord = {
      ...sampleRecord,
      status: "synced",
      errorMessage: null,
    };
    const { set } = stubUpdateResult([updatedRecord]);

    const response = await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ status: "synced", errorMessage: null });
    expect(response.data?.attributes.status).toBe("synced");
    expect(response.data?.attributes.errorMessage).toBeNull();
  });

  it("parses syncedAt into a Date before updating", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ syncedAt: "2024-01-16T10:00:00.000Z" }),
    );
    const updatedRecord = {
      ...sampleRecord,
      syncedAt: new Date("2024-01-16T10:00:00.000Z"),
    };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({
      syncedAt: new Date("2024-01-16T10:00:00.000Z"),
    });
  });

  it("allows clearing syncedAt with an explicit null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ syncedAt: null }));
    const updatedRecord = { ...sampleRecord, syncedAt: null };
    const { set } = stubUpdateResult([updatedRecord]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ syncedAt: null });
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

  it("does not write an activity event for a status/filePath/syncedAt/errorMessage-only update", async () => {
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

  it("throws 422 when syncedAt is not a string or null", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ syncedAt: 12345 }));

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
            detail: "SyncedAt must be a date string or null",
            source: { pointer: "/data/attributes/syncedAt" },
          },
        ],
      },
    });
  });

  it("throws 422 when syncedAt is an unparseable date string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ syncedAt: "not-a-date" }));

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
            detail: "SyncedAt must be a valid date string",
            source: { pointer: "/data/attributes/syncedAt" },
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
});
