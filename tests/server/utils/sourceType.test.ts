import { beforeEach, describe, expect, it, vi } from "vitest";
import { sources } from "../../../server/db/schema";

const selectMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
}));

const { resolveSourceTypes, withSourceType } =
  await import("../../../server/utils/sourceType");

const userId = "user_abc123";
const sourceIdOne = "550e8400-e29b-41d4-a716-446655440001";
const sourceIdTwo = "550e8400-e29b-41d4-a716-446655440002";

function stubSelectResult(rows: unknown[]) {
  const where = vi.fn(() => Promise.resolve(rows));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where };
}

beforeEach(() => {
  selectMock.mockReset();
});

describe("resolveSourceTypes", () => {
  it("returns an empty map without querying the db when there are no source ids", async () => {
    const map = await resolveSourceTypes(
      { select: selectMock } as never,
      userId,
      [null, undefined],
    );

    expect(map.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("resolves types for every distinct source id in a single query", async () => {
    stubSelectResult([
      { uuid: sourceIdOne, type: "webhook" },
      { uuid: sourceIdTwo, type: "github" },
    ]);

    const map = await resolveSourceTypes(
      { select: selectMock } as never,
      userId,
      [sourceIdOne, sourceIdTwo, sourceIdOne, null],
    );

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(map.get(sourceIdOne)).toBe("webhook");
    expect(map.get(sourceIdTwo)).toBe("github");
  });

  it("omits a source id the db didn't return (e.g. another tenant's source)", async () => {
    stubSelectResult([]);

    const map = await resolveSourceTypes(
      { select: selectMock } as never,
      userId,
      [sourceIdOne],
    );

    expect(map.has(sourceIdOne)).toBe(false);
  });

  it("scopes the lookup to the owning user, never another tenant's sources", async () => {
    const { where } = stubSelectResult([]);

    await resolveSourceTypes({ select: selectMock } as never, userId, [
      sourceIdOne,
    ]);

    expect(where).toHaveBeenCalledWith({
      conditions: [
        { column: sources.userId, value: userId },
        { column: sources.uuid, values: [sourceIdOne] },
      ],
    });
  });

  it("degrades to an empty map instead of throwing when the query fails", async () => {
    const where = vi.fn(() => Promise.reject(new Error("connection reset")));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const map = await resolveSourceTypes(
      { select: selectMock } as never,
      userId,
      [sourceIdOne],
    );

    expect(map.size).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("withSourceType", () => {
  it("attaches the resolved type when the record has a matching source id", () => {
    const map = new Map([[sourceIdOne, "email"]]);

    const result = withSourceType({ sourceId: sourceIdOne, title: "x" }, map);

    expect(result).toEqual({
      sourceId: sourceIdOne,
      title: "x",
      sourceType: "email",
    });
  });

  it("returns null when the record has no source id", () => {
    const result = withSourceType({ sourceId: null, title: "x" }, new Map());

    expect(result.sourceType).toBeNull();
  });

  it("returns null when the source id isn't in the map", () => {
    const result = withSourceType(
      { sourceId: sourceIdOne, title: "x" },
      new Map(),
    );

    expect(result.sourceType).toBeNull();
  });
});
