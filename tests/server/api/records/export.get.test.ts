import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { records } from "../../../../server/db/schema";
import {
  RECORD_EXPORT_FETCH_LIMIT,
  RECORD_EXPORT_LIMIT,
} from "../../../../server/utils/recordExport";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  desc: (column: unknown) => ({ desc: column }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockSetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/records/export.get"))
  .default;

const userId = "user_abc123";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function makeRecordRow(index: number) {
  return {
    uuid: `uuid-${index}`,
    createdAt: new Date(`2024-06-${String(index).padStart(2, "0")}T10:00:00Z`),
    userId,
    title: `Record ${index}`,
    content: `Body ${index}`,
    source: "webhook/github",
    sourceId: `src-${index}`,
    status: "synced",
    filePath: `/vault/record-${index}.md`,
    tags: null,
    frontmatter: null,
    syncedAt: null,
    errorMessage: null,
  };
}

function stubSelectChain(rows: unknown[]) {
  const limitFn = vi.fn(() => Promise.resolve(rows));
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  selectMock.mockReturnValue({ from: fromFn });
  return { fromFn, whereFn, orderByFn, limitFn };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("setHeader", mockSetHeader);
  mockCreateError.mockClear();
  mockSetHeader.mockClear();
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/records/export", () => {
  it("throws 401 when user is not authenticated", async () => {
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

  it("returns serialized record rows as JSON", async () => {
    const rows = [makeRecordRow(3), makeRecordRow(2), makeRecordRow(1)];
    stubSelectChain(rows);

    const response = await handler(buildEvent(userId));

    expect(Array.isArray(response)).toBe(true);
    expect((response as unknown[]).length).toBe(3);
  });

  it("scopes the query to the authenticated user", async () => {
    const { whereFn } = stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(whereFn).toHaveBeenCalledWith({
      column: records.userId,
      value: userId,
    });
  });

  it("fetches one row beyond the limit so truncation is detectable", async () => {
    const { limitFn } = stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(limitFn).toHaveBeenCalledWith(RECORD_EXPORT_FETCH_LIMIT);
  });

  it("surfaces the error and sets no download headers when the query fails", async () => {
    const { limitFn } = stubSelectChain([]);
    limitFn.mockRejectedValue(new Error("db down"));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(mockSetHeader).not.toHaveBeenCalledWith(
      expect.anything(),
      "Content-Disposition",
      expect.anything(),
    );
  });

  it("serializes createdAt as ISO string", async () => {
    const row = makeRecordRow(1);
    stubSelectChain([row]);

    const response = (await handler(buildEvent(userId))) as Array<{
      createdAt: string;
    }>;

    expect(response[0].createdAt).toBe(row.createdAt.toISOString());
  });

  it("sets content-disposition attachment header", async () => {
    stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Disposition",
      expect.stringContaining("attachment"),
    );
  });

  it("sets content-type to application/json", async () => {
    stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Type",
      "application/json",
    );
  });

  it("sets cache-control to no-store, private", async () => {
    stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store, private",
    );
  });

  it("includes title, content, and status in each row", async () => {
    stubSelectChain([makeRecordRow(1)]);

    const response = (await handler(buildEvent(userId))) as Array<{
      title: string;
      content: string;
      status: string;
    }>;

    expect(response[0].title).toBe("Record 1");
    expect(response[0].content).toBe("Body 1");
    expect(response[0].status).toBe("synced");
  });

  it("returns empty array when no records exist", async () => {
    stubSelectChain([]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual([]);
  });

  it("sets X-Export-Truncated to false when results are within the limit", async () => {
    stubSelectChain([makeRecordRow(1)]);

    await handler(buildEvent(userId));

    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "X-Export-Truncated",
      "false",
    );
  });

  it("sets X-Export-Truncated to true and caps results when over the limit", async () => {
    const fixedCreatedAt = new Date("2024-06-01T10:00:00Z");
    const overLimitRows = Array.from(
      { length: RECORD_EXPORT_LIMIT + 1 },
      (_, i) => ({
        ...makeRecordRow(1),
        uuid: `uuid-${i}`,
        createdAt: fixedCreatedAt,
      }),
    );
    stubSelectChain(overLimitRows);

    const response = (await handler(buildEvent(userId))) as unknown[];

    expect(response).toHaveLength(RECORD_EXPORT_LIMIT);
    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "X-Export-Truncated",
      "true",
    );
  });
});
