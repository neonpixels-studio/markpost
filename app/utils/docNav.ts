// The docs page (pages/docs.vue) renders this nav in its sidebar and filters
// it as the user types in the search box. Kept as a standalone module (rather
// than a local const in the page's <script setup>) so both the page and its
// tests can import the same data and filtering logic.
export const DOC_NAV = [
  {
    group: "Introduction",
    items: [
      ["quickstart", "Quickstart"],
      ["concepts", "Core concepts"],
    ],
  },
  {
    group: "API Reference",
    items: [
      ["auth", "Authentication"],
      ["webhooks", "Ingest a webhook"],
      ["email", "Email-in"],
      ["records", "List records"],
    ],
  },
  {
    group: "CLI",
    items: [
      ["cli", "Command reference"],
      ["markdown", "Markdown & frontmatter"],
    ],
  },
] as const;

type DocNav = typeof DOC_NAV;
export type DocNavGroup = DocNav[number];

// A group whose name matches the query is kept in full (e.g. searching "cli"
// or "api" should surface that whole section) — only groups that don't match
// by name get filtered down to their matching items.
export function filterDocNav(navGroups: DocNav, query: string): DocNavGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...navGroups];
  }
  return navGroups
    .map((group) => filterDocNavGroup(group, normalizedQuery))
    .filter((group) => group.items.length > 0);
}

function filterDocNavGroup(
  group: DocNavGroup,
  normalizedQuery: string,
): DocNavGroup {
  if (group.group.toLowerCase().includes(normalizedQuery)) {
    return group;
  }
  return {
    ...group,
    items: group.items.filter(([, label]) =>
      label.toLowerCase().includes(normalizedQuery),
    ),
  } as DocNavGroup;
}
