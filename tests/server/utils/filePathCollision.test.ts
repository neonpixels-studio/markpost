import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  isNotNull: (...args: unknown[]) => ({ op: "isNotNull", args }),
  ilike: (...args: unknown[]) => ({ op: "ilike", args }),
}));

import {
  resolveUniqueFilePath,
  ensureUniqueFilePath,
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

type Condition = { op: string; args: unknown[] };

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
      (condition) => condition.op === "ilike",
    );

    expect(userCondition?.args[1]).toBe("user_abc");
    expect(prefixCondition?.args[1]).toBe("2026-01-01-hello%");
  });

  it("escapes LIKE metacharacters in the collision prefix", async () => {
    const whereMock = mockTakenRows([]);
    await ensureUniqueFilePath("user_abc", "2026-01-01-50%_off.md");

    const prefixCondition = conditionsFrom(whereMock).find(
      (condition) => condition.op === "ilike",
    );

    expect(prefixCondition?.args[1]).toBe("2026-01-01-50\\%\\_off%");
  });

  it("skips the query entirely for an empty path", async () => {
    const whereMock = mockTakenRows([]);
    const result = await ensureUniqueFilePath("user_abc", "");

    expect(result).toBe("");
    expect(whereMock).not.toHaveBeenCalled();
  });
});
