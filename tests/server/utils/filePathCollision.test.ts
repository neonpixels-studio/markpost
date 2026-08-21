import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings,
    values,
  }),
}));

import {
  resolveUniqueFilePath,
  ensureUniqueFilePath,
  insertRecordWithUniqueFilePath,
  isFilePathUniqueViolation,
  FILE_PATH_UNIQUE_INDEX,
} from "../../../server/utils/filePathCollision";

describe("resolveUniqueFilePath", () => {
  it("returns the desired path when nothing is taken", () => {
    const result = resolveUniqueFilePath("2026-01-01-hello.md", new Set());
    expect(result).toBe("2026-01-01-hello.md");
  });

  it("returns the desired path when only unrelated paths are taken", () => {
    const taken = new Set(["2026-01-01-other.md"]);
    const result = resolveUniqueFilePath("2026-01-01-hello.md", taken);
    expect(result).toBe("2026-01-01-hello.md");
  });

  it("appends -2 on the first collision", () => {
    const taken = new Set(["2026-01-01-hello.md"]);
    const result = resolveUniqueFilePath("2026-01-01-hello.md", taken);
    expect(result).toBe("2026-01-01-hello-2.md");
  });

  it("skips to -3 when the -2 variant is also taken", () => {
    const taken = new Set(["2026-01-01-hello.md", "2026-01-01-hello-2.md"]);
    const result = resolveUniqueFilePath("2026-01-01-hello.md", taken);
    expect(result).toBe("2026-01-01-hello-3.md");
  });

  it("returns -2 even when a higher variant is taken but -2 is free", () => {
    const taken = new Set(["2026-01-01-hello.md", "2026-01-01-hello-5.md"]);
    const result = resolveUniqueFilePath("2026-01-01-hello.md", taken);
    expect(result).toBe("2026-01-01-hello-2.md");
  });

  it("suffixes only the filename, preserving directory segments", () => {
    const taken = new Set(["email/acme/2026-01-01-hello.md"]);
    const result = resolveUniqueFilePath(
      "email/acme/2026-01-01-hello.md",
      taken,
    );
    expect(result).toBe("email/acme/2026-01-01-hello-2.md");
  });

  it("handles an extensionless template", () => {
    const taken = new Set(["2026-01-01-hello"]);
    const result = resolveUniqueFilePath("2026-01-01-hello", taken);
    expect(result).toBe("2026-01-01-hello-2");
  });

  it("suffixes before a multi-dot filename's final extension", () => {
    const taken = new Set(["2026-01-01-notes.tar.gz"]);
    const result = resolveUniqueFilePath("2026-01-01-notes.tar.gz", taken);
    expect(result).toBe("2026-01-01-notes.tar-2.gz");
  });

  it("treats a case-only difference as a collision", () => {
    const taken = new Set(["acme/2026-01-01-hello.md"]);
    const result = resolveUniqueFilePath("Acme/2026-01-01-hello.md", taken);
    expect(result).toBe("Acme/2026-01-01-hello-2.md");
  });
});

type Condition = { op: string; args?: unknown[]; values?: unknown[] };

function mockTakenRows(rows: Array<{ filePath: string | null }>) {
  const whereMock = vi.fn(() => Promise.resolve(rows));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  selectMock.mockReturnValue({ from: fromMock });
  return whereMock;
}

function conditionsFrom(whereMock: ReturnType<typeof vi.fn>): Condition[] {
  const andExpression = whereMock.mock.calls[0][0] as {
    op: string;
    args: Condition[];
  };
  return andExpression.args;
}

describe("ensureUniqueFilePath", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it("returns the desired path when the user has no colliding record", async () => {
    mockTakenRows([]);
    const result = await ensureUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
    );
    expect(result).toBe("2026-01-01-hello.md");
  });

  it("appends a suffix when the desired path is already taken by the user", async () => {
    mockTakenRows([{ filePath: "2026-01-01-hello.md" }]);
    const result = await ensureUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
    );
    expect(result).toBe("2026-01-01-hello-2.md");
  });

  it("finds the next free suffix across multiple existing variants", async () => {
    mockTakenRows([
      { filePath: "2026-01-01-hello.md" },
      { filePath: "2026-01-01-hello-2.md" },
    ]);
    const result = await ensureUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
    );
    expect(result).toBe("2026-01-01-hello-3.md");
  });

  it("ignores null filePaths returned by the query", async () => {
    mockTakenRows([{ filePath: null }]);
    const result = await ensureUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
    );
    expect(result).toBe("2026-01-01-hello.md");
  });

  it("scopes the lookup to the user and the collision prefix", async () => {
    const whereMock = mockTakenRows([]);
    await ensureUniqueFilePath("user_abc", "2026-01-01-hello.md");

    const conditions = conditionsFrom(whereMock);
    const userCondition = conditions.find((condition) => condition.op === "eq");
    const prefixCondition = conditions.find(
      (condition) => condition.op === "sql",
    );

    expect(userCondition?.args?.[1]).toBe("user_abc");
    // The prefix is the final interpolated value in the
    // `… AND lower(file_path) LIKE lower(<pattern>)` template.
    expect(prefixCondition?.values?.at(-1)).toBe("2026-01-01-hello%");
  });

  it("escapes LIKE metacharacters in the collision prefix", async () => {
    const whereMock = mockTakenRows([]);
    await ensureUniqueFilePath("user_abc", "2026-01-01-50%_off.md");

    const prefixCondition = conditionsFrom(whereMock).find(
      (condition) => condition.op === "sql",
    );

    expect(prefixCondition?.values?.at(-1)).toBe("2026-01-01-50\\%\\_off%");
  });

  it("skips the query entirely for an empty path", async () => {
    const whereMock = mockTakenRows([]);
    const result = await ensureUniqueFilePath("user_abc", "");

    expect(result).toBe("");
    expect(whereMock).not.toHaveBeenCalled();
  });
});

function uniqueViolation(constraint: string = FILE_PATH_UNIQUE_INDEX): Error {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint,
  });
}

describe("isFilePathUniqueViolation", () => {
  it("detects the violation at the top level", () => {
    expect(isFilePathUniqueViolation(uniqueViolation())).toBe(true);
  });

  it("walks past a wrapper carrying an unrelated code to a nested violation", () => {
    const wrapped = Object.assign(new Error("query failed"), {
      code: "ERR_QUERY",
      cause: uniqueViolation(),
    });
    expect(isFilePathUniqueViolation(wrapped)).toBe(true);
  });

  it("is false for a 23505 on a different constraint", () => {
    expect(isFilePathUniqueViolation(uniqueViolation("other_unique"))).toBe(
      false,
    );
  });

  it("is false for a non-Postgres error and terminates on a cause cycle", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isFilePathUniqueViolation(cyclic)).toBe(false);
    expect(isFilePathUniqueViolation(new Error("boom"))).toBe(false);
  });
});

describe("insertRecordWithUniqueFilePath", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it("returns the insert result on the first attempt when there is no collision", async () => {
    const insert = vi.fn().mockResolvedValue({ uuid: "r1" });

    const result = await insertRecordWithUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
      insert,
    );

    expect(result).toEqual({ uuid: "r1" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith("2026-01-01-hello.md");
  });

  it("re-suffixes the path and retries when the insert hits the file_path unique violation", async () => {
    mockTakenRows([{ filePath: "2026-01-01-hello.md" }]);
    const insert = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ uuid: "r2" });

    const result = await insertRecordWithUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
      insert,
    );

    expect(result).toEqual({ uuid: "r2" });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(1, "2026-01-01-hello.md");
    expect(insert).toHaveBeenNthCalledWith(2, "2026-01-01-hello-2.md");
  });

  it("detects a unique violation wrapped under `cause`", async () => {
    mockTakenRows([{ filePath: "2026-01-01-hello.md" }]);
    const wrapped = Object.assign(new Error("insert failed"), {
      cause: uniqueViolation(),
    });
    const insert = vi
      .fn()
      .mockRejectedValueOnce(wrapped)
      .mockResolvedValueOnce({ uuid: "r3" });

    const result = await insertRecordWithUniqueFilePath(
      "user_abc",
      "2026-01-01-hello.md",
      insert,
    );

    expect(result).toEqual({ uuid: "r3" });
    expect(insert).toHaveBeenNthCalledWith(2, "2026-01-01-hello-2.md");
  });

  it("rethrows a non-unique-violation error without retrying", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("connection reset"));

    await expect(
      insertRecordWithUniqueFilePath("user_abc", "a.md", insert),
    ).rejects.toThrow("connection reset");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("rethrows a 23505 raised by a different constraint without retrying", async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(uniqueViolation("records_some_other_unique"));

    await expect(
      insertRecordWithUniqueFilePath("user_abc", "a.md", insert),
    ).rejects.toMatchObject({ constraint: "records_some_other_unique" });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("stops immediately and rethrows when the resolver cannot free a new path", async () => {
    // No taken rows means the resolver hands back the same path it was given, so
    // a retry could only lose again — bail out loud rather than burn the budget.
    mockTakenRows([]);
    const insert = vi.fn().mockRejectedValue(uniqueViolation());

    await expect(
      insertRecordWithUniqueFilePath("user_abc", "a.md", insert),
    ).rejects.toMatchObject({ code: "23505" });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("retries up to the attempt budget then rethrows when every insert loses", async () => {
    // Each failed insert claims its path, so the resolver keeps producing a new
    // suffix (progress every round) — this exercises the fixed attempt ceiling.
    const taken: string[] = [];
    const whereMock = vi.fn(() =>
      Promise.resolve(taken.map((filePath) => ({ filePath }))),
    );
    const fromMock = vi.fn(() => ({ where: whereMock }));
    selectMock.mockReturnValue({ from: fromMock });

    const insert = vi.fn((filePath: string | null | undefined) => {
      taken.push(String(filePath));
      return Promise.reject(uniqueViolation());
    });

    await expect(
      insertRecordWithUniqueFilePath("user_abc", "a.md", insert),
    ).rejects.toMatchObject({ code: "23505" });
    expect(insert).toHaveBeenCalledTimes(5);
  });
});
