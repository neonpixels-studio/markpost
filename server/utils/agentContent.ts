// Machine-readable content helpers shared by the agentContent middleware.
//
// These power three agent-facing behaviours on non-API (HTML) routes:
//   1. A real Markdown representation of the main content pages, served when a
//      client negotiates for it (`Accept: text/markdown`, or a `.md` suffix).
//   2. A Markdown 404 body — with pointers to the sitemap, llms.txt and docs —
//      for unknown paths, so an agent probing the site learns where to look
//      instead of concluding every path exists.
// The strings are authored here (not fetched from the rendered Vue pages) so
// the Markdown stays terse and stable regardless of how the UI changes.

export const SITE_NAME = "Markpost";

// Content routes that expose a Markdown representation via Accept negotiation.
export const MARKDOWN_ROUTES = new Set(["/", "/docs", "/pricing"]);

// Every first-party page path. Used to tell a real route apart from an unknown
// path when deciding whether to serve a 404 to a Markdown-negotiating client.
export const KNOWN_PATHS = new Set<string>([
  "/",
  "/docs",
  "/pricing",
  "/inbox",
  "/activity",
  "/sources",
  "/settings",
  "/login",
]);

export const MARKDOWN_MEDIA_TYPES = ["text/markdown", "text/x-markdown"];
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

// acceptmarkdown.com: caches must key the HTML and Markdown variants apart, so
// both variants carry `Vary: Accept`. Accept-Encoding is kept for compression.
export const NEGOTIATION_VARY = "Accept, Accept-Encoding";

type AcceptEntry = {
  type: string;
  q: number;
};

// Strips the query string and any trailing slash (except the root) so lookups
// against KNOWN_PATHS / MARKDOWN_ROUTES are exact.
export function normalizePath(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0] ?? "/";
  if (withoutQuery === "/") {
    return "/";
  }
  return withoutQuery.replace(/\/+$/, "") || "/";
}

function parseAcceptHeader(acceptHeader: string): AcceptEntry[] {
  return acceptHeader
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [type, ...params] = part.split(";").map((token) => token.trim());
      const qParam = params.find((param) => param.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return {
        type: (type ?? "").toLowerCase(),
        q: Number.isFinite(q) ? q : 1,
      };
    });
}

function qualityFor(entries: AcceptEntry[], mediaType: string): number {
  const match = entries.find((entry) => entry.type === mediaType);
  return match ? match.q : 0;
}

// A client wants Markdown when it explicitly negotiates for it: either the path
// carries a `.md` suffix, or its Accept header ranks a Markdown media type above
// text/html. A bare browser `Accept: text/html,...` never triggers this.
export function wantsMarkdown(
  acceptHeader: string | null | undefined,
  path: string,
): boolean {
  if (hasMarkdownSuffix(path)) {
    return true;
  }

  if (!acceptHeader) {
    return false;
  }

  const entries = parseAcceptHeader(acceptHeader);
  const markdownQuality = Math.max(
    ...MARKDOWN_MEDIA_TYPES.map((type) => qualityFor(entries, type)),
  );

  if (markdownQuality <= 0) {
    return false;
  }

  const htmlQuality = qualityFor(entries, "text/html");
  return markdownQuality >= htmlQuality;
}

export function hasMarkdownSuffix(path: string): boolean {
  return normalizePath(path).endsWith(".md");
}

// Maps a request path to the content route it addresses, resolving a `.md`
// suffix (e.g. `/docs.md` -> `/docs`). Returns null when the path is not a
// Markdown content route.
export function resolveMarkdownRoute(path: string): string | null {
  const normalized = normalizePath(path).replace(/\.md$/, "") || "/";
  return MARKDOWN_ROUTES.has(normalized) ? normalized : null;
}

export function isKnownPath(path: string): boolean {
  const normalized = normalizePath(path).replace(/\.md$/, "") || "/";
  return KNOWN_PATHS.has(normalized);
}

function buildHomeMarkdown(siteUrl: string): string {
  return `# ${SITE_NAME}

Markpost catches inbound webhooks and email, converts them to clean Markdown
with YAML frontmatter (title, tags, source and timestamps), and its CLI syncs
them straight into your local Obsidian vault.

## Start here

- [Documentation](/docs) — quickstart, authentication, webhooks, email-in.
- [Pricing](/pricing) — Hobby ($0) and Pro plans.
- [OpenAPI specification](/openapi.json) — the full HTTP API surface.
- [llms.txt](/llms.txt) — index of machine-readable resources.

## API

Base URL: \`${siteUrl}/api\`. All requests authenticate with a bearer token
(\`Authorization: Bearer mp_live_...\`). See [/docs](/docs) and
[/openapi.json](/openapi.json).
`;
}

function buildDocsMarkdown(siteUrl: string): string {
  return `# ${SITE_NAME} documentation

Base URL: \`${siteUrl}/api\` — every request authenticates with a bearer token
(\`Authorization: Bearer mp_live_...\`).

## Sections

- Quickstart — from zero to your first synced Markdown file.
- Core concepts — records, sources, sync.
- Authentication — mint and use bearer tokens.
- Ingest a webhook — POST JSON to \`/api/hooks/:slug\` to create a record.
- Email-in — forward mail to capture it as Markdown.
- List records — read pending and synced records over the API.
- Command reference — the markpost CLI.
- Markdown & frontmatter — how records become files in your vault.

## Machine-readable resources

- [OpenAPI specification](/openapi.json)
- [Protected-resource metadata](/.well-known/oauth-protected-resource)
- [llms.txt](/llms.txt)
`;
}

// Pricing carries no absolute URLs, so it needs no configured app URL.
const PRICING_MARKDOWN = `# ${SITE_NAME} pricing

## Hobby — $0

- 100 records / month
- 1 connected source

## Pro — $10/mo ($8/mo billed yearly, $80/year)

- Everything in Hobby, plus:
- Unlimited connected sources
- Unlimited records / month
- Unlimited retention
- 14-day free trial, no card to start

See [/pricing](/pricing) for the full comparison, or [/docs](/docs) to get
started.
`;

// Each builder receives the configured app URL (resolved by the caller) so the
// advertised API base tracks the actual deploy domain rather than a hardcoded
// host. Pricing carries no absolute URLs, so its builder ignores the argument.
const ROUTE_MARKDOWN: Record<string, (siteUrl: string) => string> = {
  "/": buildHomeMarkdown,
  "/docs": buildDocsMarkdown,
  "/pricing": () => PRICING_MARKDOWN,
};

export function markdownForRoute(path: string, siteUrl: string): string | null {
  const route = resolveMarkdownRoute(path);
  if (!route) {
    return null;
  }

  const buildMarkdown = ROUTE_MARKDOWN[route];
  if (!buildMarkdown) {
    return null;
  }

  return buildMarkdown(siteUrl);
}

export function notFoundMarkdown(path: string): string {
  const cleanPath = normalizePath(path);
  return `# 404 — Not Found

No resource exists at \`${cleanPath}\` on ${SITE_NAME}.

Try one of these instead:

- [Home](/)
- [Documentation](/docs)
- [Sitemap](/sitemap.xml)
- [llms.txt](/llms.txt) — index of machine-readable resources
- [OpenAPI specification](/openapi.json)
`;
}
