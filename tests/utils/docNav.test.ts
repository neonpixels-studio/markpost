import { describe, it, expect } from "vitest";
import { DOC_NAV, filterDocNav } from "../../app/utils/docNav";

describe("filterDocNav", () => {
  it("returns every group and item for an empty query", () => {
    expect(filterDocNav(DOC_NAV, "")).toEqual(DOC_NAV);
  });

  it("returns every group and item for a whitespace-only query", () => {
    expect(filterDocNav(DOC_NAV, "   ")).toEqual(DOC_NAV);
  });

  it("filters items within a group by a partial, case-insensitive label match", () => {
    const result = filterDocNav(DOC_NAV, "AUTH");
    expect(result).toEqual([
      {
        group: "API Reference",
        items: [["auth", "Authentication"]],
      },
    ]);
  });

  it("keeps every item in a group whose name matches, even if no item label does", () => {
    const result = filterDocNav(DOC_NAV, "cli");
    expect(result).toEqual([
      {
        group: "CLI",
        items: [
          ["cli", "Command reference"],
          ["markdown", "Markdown & frontmatter"],
        ],
      },
    ]);
  });

  it("drops groups with no matching group name or item label", () => {
    expect(filterDocNav(DOC_NAV, "nonexistent-topic")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const snapshotBefore = JSON.parse(JSON.stringify(DOC_NAV));
    filterDocNav(DOC_NAV, "auth");
    expect(DOC_NAV).toEqual(snapshotBefore);
  });
});
