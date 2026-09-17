import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const selectMock = vi.fn(() => ({ from: selectFrom }));

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

// A table identity so the assertions catch a query aimed at the wrong table.
vi.mock("../../../server/db/schema", () => ({
  userSettings: "user_settings_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

const { fetchFilenameTemplate } =
  await import("../../../server/utils/userSettings");

describe("fetchFilenameTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectWhere.mockImplementation(() => ({ limit: selectLimit }));
  });

  it("returns the user's stored filenameTemplate", async () => {
    selectLimit.mockResolvedValueOnce([{ filenameTemplate: "{{slug}}.md" }]);

    await expect(fetchFilenameTemplate("user_1")).resolves.toBe("{{slug}}.md");
    expect(selectFrom).toHaveBeenCalledWith("user_settings_table");
    expect(selectWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: "user_1" }),
    );
  });

  it("falls back to the default template when the user has no settings row", async () => {
    selectLimit.mockResolvedValueOnce([]);

    await expect(fetchFilenameTemplate("user_1")).resolves.toBe(
      "{{date}}-{{slug}}.md",
    );
  });

  it("does not fall back for an empty-string filenameTemplate (?? only catches null/undefined, matching the row's not-null column default)", async () => {
    selectLimit.mockResolvedValueOnce([{ filenameTemplate: "" }]);

    await expect(fetchFilenameTemplate("user_1")).resolves.toBe("");
  });
});
