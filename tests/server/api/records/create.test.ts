import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { ApiError } from "../../../../server/utils/errors";

const insertMock = vi.fn();
const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ insert: insertMock, select: selectMock }),
}));

// drizzle-orm eq/and used by validateSourceOwnership; isNotNull/ilike used by
// the filePath collision lookup. Mock them all as pass-throughs.
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ conditions }),
  isNotNull: (column: unknown) => ({ op: "isNotNull", column }),
  ilike: (column: unknown, pattern: unknown) => ({
    op: "ilike",
    column,
    pattern,
  }),
}));

// The Hobby plan cap check is a separate concern with its own test coverage
// (tests/server/utils/planLimits.test.ts); mock it here so these tests focus
// on request handling and default to "within limit".
const mockAssertWithinRecordLimit = vi.fn();

vi.mock("../../../../server/utils/planLimits", () => ({
  assertWithinRecordLimit: (...args: unknown[]) =>
    mockAssertWithinRecordLimit(...args),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();
const mockSetResponseStatus = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/records/index.post"))
  .default;

const userId = "user_abc123";
const validSourceId = "550e8400-e29b-41d4-a716-446655440099";

const sampleRecord = {
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  userId,
  title: "My Title",
  content: "My Content",
  sourceId: null,
  source: null,
  status: "pending",
  filePath: null,
  tags: null,
  frontmatter: null,
  syncedAt: null,
  errorMessage: null,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(attributes: Record<string, unknown>) {
  return { data: { type: "records", attributes } };
}

function stubInsertResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const values = vi.fn(() => ({ returning }));
  insertMock.mockReturnValue({ values });
  return { values, returning };
}

function stubSelectSourceResult(rows: unknown[]) {
  const where = vi.fn(() => Promise.resolve(rows));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where };
}

// fetchFilenameTemplate resolves at `.where().limit()`; the filePath collision
// lookup resolves at `.where()`. The markdown pipeline (html present, no
// client filePath) runs the settings select first, then the collision select.
function stubHtmlPipelineSelects(
  filenameTemplate: string,
  collisionRows: unknown[],
) {
  const settingsLimit = vi.fn(() => Promise.resolve([{ filenameTemplate }]));
  const settingsWhere = vi.fn(() => ({ limit: settingsLimit }));
  const settingsFrom = vi.fn(() => ({ where: settingsWhere }));

  const collisionWhere = vi.fn(() => Promise.resolve(collisionRows));
  const collisionFrom = vi.fn(() => ({ where: collisionWhere }));

  selectMock
    .mockReturnValueOnce({ from: settingsFrom })
    .mockReturnValueOnce({ from: collisionFrom });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  mockSetResponseStatus.mockClear();
  insertMock.mockReset();
  selectMock.mockReset();
  mockAssertWithinRecordLimit.mockReset();
  mockAssertWithinRecordLimit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/records", () => {
  it("returns a 201 with the serialized record on valid input", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content" }),
    );
    stubInsertResult([sampleRecord]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(response).toEqual({
      data: {
        type: "records",
        id: sampleRecord.uuid,
        attributes: {
          uuid: sampleRecord.uuid,
          createdAt: sampleRecord.createdAt,
          userId,
          title: sampleRecord.title,
          content: sampleRecord.content,
          sourceId: null,
          source: null,
          status: "pending",
          filePath: null,
          tags: null,
          frontmatter: null,
          syncedAt: null,
          errorMessage: null,
        },
        links: { self: `/api/records/${sampleRecord.uuid}` },
      },
    });
  });

  it("throws a 422 with one error when title is missing", async () => {
    mockReadBody.mockResolvedValue(buildBody({ content: "My Content" }));

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
            detail: "Title is required",
            source: { pointer: "/data/attributes/title" },
          },
        ],
      },
    });
  });

  it("throws a 422 with one error when both content and html are missing", async () => {
    mockReadBody.mockResolvedValue(buildBody({ title: "My Title" }));

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
            detail: "Content or html is required",
            source: { pointer: "/data/attributes/content" },
          },
        ],
      },
    });
  });

  it("throws a 422 with one error when title is not a string", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: {}, content: "My Content" }),
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
            detail: "Title must be a string",
            source: { pointer: "/data/attributes/title" },
          },
        ],
      },
    });
  });

  it("throws a 422 with one error when content is not a string", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: 123 }),
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
            detail: "Content must be a string",
            source: { pointer: "/data/attributes/content" },
          },
        ],
      },
    });
  });

  it("throws a 422 with two errors when both title and content are not strings", async () => {
    mockReadBody.mockResolvedValue(buildBody({ title: {}, content: 123 }));

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
            detail: "Title must be a string",
            source: { pointer: "/data/attributes/title" },
          },
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

  it("throws a 422 with one error when title is missing and neither content nor html is given", async () => {
    mockReadBody.mockResolvedValue(buildBody({}));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    // title is still required via apiValidate; content/html check fires only after title passes
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "Title is required",
            source: { pointer: "/data/attributes/title" },
          },
        ],
      },
    });
  });

  it("throws a 401 when the user is not authenticated", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content" }),
    );

    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  });

  it("accepts optional fields and passes them to the insert", async () => {
    const syncedAtString = "2026-06-14T12:00:00Z";
    const sampleRecordWithExtras = {
      ...sampleRecord,
      sourceId: validSourceId,
      source: "webhook/github",
      status: "synced",
      filePath: "99-incoming/2026-06-14-deploy.md",
      tags: ["deploy"],
      frontmatter: { date: "2026-06-14" },
      syncedAt: new Date(syncedAtString),
      errorMessage: null,
    };

    stubSelectSourceResult([{ uuid: validSourceId }]);
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        sourceId: validSourceId,
        source: "webhook/github",
        status: "synced",
        filePath: "99-incoming/2026-06-14-deploy.md",
        tags: ["deploy"],
        frontmatter: { date: "2026-06-14" },
        syncedAt: syncedAtString,
        errorMessage: null,
      }),
    );
    stubInsertResult([sampleRecordWithExtras]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(response).toEqual({
      data: {
        type: "records",
        id: sampleRecordWithExtras.uuid,
        attributes: {
          uuid: sampleRecordWithExtras.uuid,
          createdAt: sampleRecordWithExtras.createdAt,
          userId,
          title: sampleRecordWithExtras.title,
          content: sampleRecordWithExtras.content,
          sourceId: validSourceId,
          source: "webhook/github",
          status: "synced",
          filePath: "99-incoming/2026-06-14-deploy.md",
          tags: ["deploy"],
          frontmatter: { date: "2026-06-14" },
          syncedAt: new Date(syncedAtString),
          errorMessage: null,
        },
        links: { self: `/api/records/${sampleRecordWithExtras.uuid}` },
      },
    });
  });

  it("disambiguates a generated filePath that collides with an existing record", async () => {
    stubHtmlPipelineSelects("{{date}}-{{slug}}.md", [
      { filePath: "2026-06-14-deploy-succeeded.md" },
    ]);
    const { values } = stubInsertResult([sampleRecord]);
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "Deploy succeeded",
        html: "<p>All green</p>",
        created: "2026-06-14T00:00:00.000Z",
      }),
    );

    await handler(buildEvent(userId));

    const insertedValues = (
      values.mock.calls[0] as [Record<string, unknown>]
    )[0];
    expect(insertedValues.filePath).toBe("2026-06-14-deploy-succeeded-2.md");
  });

  it("preserves a client-supplied filePath even when html is present", async () => {
    stubHtmlPipelineSelects("{{date}}-{{slug}}.md", [
      { filePath: "custom/path.md" },
    ]);
    const { values } = stubInsertResult([sampleRecord]);
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "Deploy succeeded",
        html: "<p>All green</p>",
        filePath: "custom/path.md",
        created: "2026-06-14T00:00:00.000Z",
      }),
    );

    await handler(buildEvent(userId));

    const insertedValues = (
      values.mock.calls[0] as [Record<string, unknown>]
    )[0];
    expect(insertedValues.filePath).toBe("custom/path.md");
  });

  it("throws a 422 when status is not a valid enum value", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        status: "invalid",
      }),
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
            detail: "Status must be one of: synced, pending, error",
            source: { pointer: "/data/attributes/status" },
          },
        ],
      },
    });
  });

  it("accepts status synced without error", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content", status: "synced" }),
    );
    stubInsertResult([{ ...sampleRecord, status: "synced" }]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(
      (response as { data: { attributes: { status: string } } }).data.attributes
        .status,
    ).toBe("synced");
  });

  it("accepts status error without error", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        status: "error",
        errorMessage: "Sync failed",
      }),
    );
    stubInsertResult([
      { ...sampleRecord, status: "error", errorMessage: "Sync failed" },
    ]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(
      (
        response as {
          data: { attributes: { status: string; errorMessage: string } };
        }
      ).data.attributes.status,
    ).toBe("error");
    expect(
      (
        response as {
          data: { attributes: { status: string; errorMessage: string } };
        }
      ).data.attributes.errorMessage,
    ).toBe("Sync failed");
  });

  it("throws a 422 when syncedAt is not a valid date string", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        syncedAt: "not-a-date",
      }),
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
            detail: "SyncedAt must be a valid date string",
            source: { pointer: "/data/attributes/syncedAt" },
          },
        ],
      },
    });
  });

  it("throws a 422 when syncedAt is not a string", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        syncedAt: 1234567890,
      }),
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
            detail: "SyncedAt must be a date string",
            source: { pointer: "/data/attributes/syncedAt" },
          },
        ],
      },
    });
  });

  it("accepts a null syncedAt without error", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content", syncedAt: null }),
    );
    stubInsertResult([sampleRecord]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(
      (response as { data: { attributes: { syncedAt: null } } }).data.attributes
        .syncedAt,
    ).toBeNull();
  });

  it("throws a 422 when tags is not an array", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        tags: "not-an-array",
      }),
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
            detail: "Tags must be an array",
            source: { pointer: "/data/attributes/tags" },
          },
        ],
      },
    });
  });

  it("throws a 422 when frontmatter is not an object", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        frontmatter: ["array", "not", "object"],
      }),
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
            detail: "Frontmatter must be an object",
            source: { pointer: "/data/attributes/frontmatter" },
          },
        ],
      },
    });
  });

  it("accepts null tags without error", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content", tags: null }),
    );
    stubInsertResult([sampleRecord]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(
      (response as { data: { attributes: { tags: null } } }).data.attributes
        .tags,
    ).toBeNull();
  });

  it("throws a 422 when sourceId does not belong to the authenticated user", async () => {
    stubSelectSourceResult([]);
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        sourceId: validSourceId,
      }),
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
            detail: "Source not found or does not belong to you",
            source: { pointer: "/data/attributes/sourceId" },
          },
        ],
      },
    });
  });

  it("checks the Hobby record cap for the authenticated user before inserting", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content" }),
    );
    stubInsertResult([sampleRecord]);

    await handler(buildEvent(userId));

    expect(mockAssertWithinRecordLimit).toHaveBeenCalledWith(userId);
    expect(insertMock).toHaveBeenCalled();
  });

  it("blocks the write with whatever error assertWithinRecordLimit throws when the Hobby cap is reached", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content" }),
    );
    mockAssertWithinRecordLimit.mockRejectedValue(
      new ApiError(
        [
          {
            status: "403",
            title: "Plan Limit Reached",
            detail:
              "You've reached the Hobby plan limit of 100 records per month. Upgrade to Pro for unlimited usage.",
          },
        ],
        403,
      ),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws a 422 when sourceId is a malformed (non-UUID) string", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        title: "My Title",
        content: "My Content",
        sourceId: "not-a-uuid",
      }),
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
            detail: "SourceId must be a valid UUID",
            source: { pointer: "/data/attributes/sourceId" },
          },
        ],
      },
    });
  });

  it("throws a 422 when status is null (does not override DB NOT NULL default)", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content", status: null }),
    );
    // status: null is treated as absent by isAbsent, so it falls back to DB default.
    // The insert succeeds and returns the record with default status.
    stubInsertResult([sampleRecord]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(
      (response as { data: { attributes: { status: string } } }).data.attributes
        .status,
    ).toBe("pending");
  });

  it("does not write status to insert values when status is empty string", async () => {
    const { values } = stubInsertResult([sampleRecord]);
    mockReadBody.mockResolvedValue(
      buildBody({ title: "My Title", content: "My Content", status: "" }),
    );

    await handler(buildEvent(userId));

    // The values passed to .insert() should not contain an explicit status key
    // so the DB default ('pending') applies.
    const insertedValues = (
      values.mock.calls[0] as [Record<string, unknown>]
    )[0];

    expect(Object.prototype.hasOwnProperty.call(insertedValues, "status")).toBe(
      false,
    );
  });
});
