// Machine-readable static assets whose body embeds the site's own origin
// (openapi.json, llms.txt, sitemap.xml). They used to be committed under
// public/ with the origin baked in, so a custom-domain deploy served a stale
// dh-markpost.netlify.app origin — breaking, among other things, the RFC 9728
// resource_documentation link. Serving them from routes lets each interpolate
// the configured app URL (buildAppUrl) at request time instead.

import { buildAppUrl } from "./appUrl";
import openApiTemplate from "./openapi.template.json";

// Every template marks where the configured origin belongs with this token, so
// interpolation is one concern regardless of the asset's format.
const APP_URL_PLACEHOLDER = "{{APP_URL}}";

export const OPENAPI_CONTENT_TYPE = "application/json; charset=utf-8";
export const LLMS_CONTENT_TYPE = "text/plain; charset=utf-8";
export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";

// The placeholder sits inside already-serialized JSON/XML, so the configured
// origin is spliced in as raw text. Escape it for the target format at the seam
// so an origin carrying a reserved character can't produce an unparseable body.
// A replacer function (not a string) is required so `$`-sequences in the origin
// aren't reinterpreted by replaceAll as substitution patterns. llms.txt is
// plain text/Markdown and a valid origin carries no Markdown metacharacters, so
// it interpolates unescaped.
function interpolate(template: string, value: string): string {
  return template.replaceAll(APP_URL_PLACEHOLDER, () => value);
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// The template is immutable, so serialize it once; only the origin varies.
const OPENAPI_TEMPLATE_JSON = JSON.stringify(openApiTemplate, null, 2);

export function buildOpenApiJson(): string {
  return interpolate(OPENAPI_TEMPLATE_JSON, jsonEscape(buildAppUrl()));
}

const LLMS_TXT_TEMPLATE = `# Markpost

> Markpost catches inbound webhooks and email, converts them to clean Markdown with YAML frontmatter (title, tags, source, timestamps), and its CLI syncs them straight into your local Obsidian vault.

Base URL: ${APP_URL_PLACEHOLDER}. The HTTP API lives under \`/api\` and authenticates with a bearer token (\`Authorization: Bearer mp_live_...\`), minted from Settings or \`POST /api/tokens\`. Public ingest endpoints (\`/api/hooks/{slug}\`) authenticate with a per-source signature instead.

Content pages also serve a Markdown representation via content negotiation: request them with \`Accept: text/markdown\` (or append \`.md\`).

## Docs

- [Documentation](${APP_URL_PLACEHOLDER}/docs): quickstart, core concepts, authentication, webhooks, email-in, records API, CLI reference, and Markdown/frontmatter.
- [Pricing](${APP_URL_PLACEHOLDER}/pricing): Hobby ($0) and Pro plans.
- [Home](${APP_URL_PLACEHOLDER}/): product overview.

## API & machine-readable resources

- [OpenAPI specification](${APP_URL_PLACEHOLDER}/openapi.json): the full HTTP API surface (OpenAPI 3.1).
- [Protected-resource metadata](${APP_URL_PLACEHOLDER}/.well-known/oauth-protected-resource): RFC 9728 metadata declaring the API's supported OAuth scopes.
- [Sitemap](${APP_URL_PLACEHOLDER}/sitemap.xml): all public URLs.

## Markdown representations

- [Documentation (Markdown)](${APP_URL_PLACEHOLDER}/docs.md)
- [Pricing (Markdown)](${APP_URL_PLACEHOLDER}/pricing.md)

The home page's Markdown is served from the root URL when requested with \`Accept: text/markdown\`.
`;

export function buildLlmsTxt(): string {
  return interpolate(LLMS_TXT_TEMPLATE, buildAppUrl());
}

type SitemapEntry = {
  path: string;
  changefreq: string;
  priority: string;
};

// Public URLs the sitemap advertises. Paths are relative; the configured origin
// is prepended per request so the sitemap tracks whatever domain serves it.
const SITEMAP_ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/docs", changefreq: "weekly", priority: "0.9" },
  { path: "/pricing", changefreq: "monthly", priority: "0.8" },
  { path: "/login", changefreq: "monthly", priority: "0.5" },
];

function renderSitemapEntry(entry: SitemapEntry): string {
  return `  <url>
    <loc>${APP_URL_PLACEHOLDER}${entry.path}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
}

export function buildSitemapXml(): string {
  const urls = SITEMAP_ENTRIES.map(renderSitemapEntry).join("\n");
  const sitemapDocument = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return interpolate(sitemapDocument, xmlEscape(buildAppUrl()));
}
