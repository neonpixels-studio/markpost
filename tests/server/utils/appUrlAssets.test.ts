import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCOPE_NAMES } from "../../../server/utils/protectedResource";
import openApiTemplate from "../../../server/utils/openapi.template.json";
import {
  buildLlmsTxt,
  buildOpenApiJson,
  buildSitemapXml,
} from "../../../server/utils/appUrlAssets";

const TEST_APP_URL = "https://custom.example.com";
const STALE_ORIGIN = "dh-markpost.netlify.app";

// Every REST endpoint the server exposes under /api, keyed without the /api
// prefix (the spec's server URL already carries it). Keep this in lockstep with
// server/api/** so a new or removed route fails the test until the spec catches
// up.
const EXPECTED_OPERATIONS: Record<string, string[]> = {
  "/records": ["get", "post", "delete"],
  "/records/{uuid}": ["get", "patch"],
  "/records/export": ["get"],
  "/records/stats": ["get"],
  "/sources": ["get", "post"],
  "/sources/{uuid}": ["patch", "delete"],
  "/sources/{uuid}/rotate-secret": ["post"],
  "/events": ["get"],
  "/events/export": ["get"],
  "/tokens": ["get", "post"],
  "/tokens/{id}": ["delete"],
  "/settings": ["get", "put"],
  "/billing/usage": ["get"],
  "/billing/checkout": ["post"],
  "/billing/portal": ["post"],
  "/billing/webhook": ["post"],
  "/account": ["delete"],
  "/hooks/{slug}": ["post"],
};

// Endpoints the auth middleware leaves public — they must opt out of the global
// bearer requirement with `security: []`.
const PUBLIC_OPERATIONS: Array<[string, string]> = [
  ["/hooks/{slug}", "post"],
  ["/billing/webhook", "post"],
];

function collectRefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, found));
    return found;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        found.push(value);
        continue;
      }
      collectRefs(value, found);
    }
  }
  return found;
}

function resolvePointer(root: unknown, ref: string): unknown {
  const segments = ref.replace(/^#\//, "").split("/");
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

let previousAppUrl: string | undefined;

beforeEach(() => {
  previousAppUrl = process.env.NUXT_PUBLIC_APP_URL;
  process.env.NUXT_PUBLIC_APP_URL = TEST_APP_URL;
});

afterEach(() => {
  if (previousAppUrl === undefined) {
    delete process.env.NUXT_PUBLIC_APP_URL;
    return;
  }
  process.env.NUXT_PUBLIC_APP_URL = previousAppUrl;
});

describe("openapi.json asset", () => {
  it("interpolates the configured app URL and drops the stale origin", () => {
    const spec = JSON.parse(buildOpenApiJson());

    expect(spec.servers?.[0]?.url).toBe(`${TEST_APP_URL}/api`);
    expect(spec.info?.contact?.url).toBe(TEST_APP_URL);
    expect(buildOpenApiJson()).not.toContain(STALE_ORIGIN);
  });

  it("is a valid OpenAPI 3.1 document with the expected metadata", () => {
    const spec = JSON.parse(buildOpenApiJson());

    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toBe("Markpost API");
    expect(spec.info?.version).toBeTypeOf("string");
  });

  it("declares the bearer security scheme globally", () => {
    const spec = JSON.parse(buildOpenApiJson());
    const scheme = spec.components?.securitySchemes?.bearerAuth;

    expect(scheme).toMatchObject({ type: "http", scheme: "bearer" });
    expect(spec.security).toContainEqual({ bearerAuth: [] });
  });

  it("documents exactly the REST endpoints the server exposes", () => {
    const spec = JSON.parse(buildOpenApiJson());

    expect(Object.keys(spec.paths).sort()).toEqual(
      Object.keys(EXPECTED_OPERATIONS).sort(),
    );

    for (const [path, methods] of Object.entries(EXPECTED_OPERATIONS)) {
      const item = spec.paths[path];
      for (const method of methods) {
        expect(item?.[method], `${method.toUpperCase()} ${path}`).toBeTypeOf(
          "object",
        );
      }
    }
  });

  it("marks the public ingest endpoints as unauthenticated", () => {
    const spec = JSON.parse(buildOpenApiJson());

    for (const [path, method] of PUBLIC_OPERATIONS) {
      expect(spec.paths[path][method].security).toEqual([]);
    }
  });

  it("catalogs the same scopes as the protected-resource metadata", () => {
    expect(Object.keys(openApiTemplate["x-scopes"]).sort()).toEqual(
      [...SCOPE_NAMES].sort(),
    );
  });

  it("has no dangling internal $refs", () => {
    const spec = JSON.parse(buildOpenApiJson());
    const refs = collectRefs(spec).filter((ref) => ref.startsWith("#/"));

    expect(refs.length).toBeGreaterThan(0);

    const dangling = refs.filter(
      (ref) => resolvePointer(spec, ref) === undefined,
    );
    expect(dangling).toEqual([]);
  });
});

describe("llms.txt asset", () => {
  it("interpolates the configured app URL and drops the stale origin", () => {
    const llms = buildLlmsTxt();

    expect(llms).toContain(`Base URL: ${TEST_APP_URL}.`);
    expect(llms).toContain(`[Documentation](${TEST_APP_URL}/docs)`);
    expect(llms).toContain(
      `[OpenAPI specification](${TEST_APP_URL}/openapi.json)`,
    );
    expect(llms).not.toContain(STALE_ORIGIN);
    expect(llms).not.toContain("{{APP_URL}}");
  });
});

describe("sitemap.xml asset", () => {
  it("interpolates the configured app URL and drops the stale origin", () => {
    const sitemap = buildSitemapXml();

    expect(sitemap).toContain(`<loc>${TEST_APP_URL}/</loc>`);
    expect(sitemap).toContain(`<loc>${TEST_APP_URL}/docs</loc>`);
    expect(sitemap).toContain(`<loc>${TEST_APP_URL}/login</loc>`);
    expect(sitemap).not.toContain(STALE_ORIGIN);
    expect(sitemap).not.toContain("{{APP_URL}}");
  });

  it("is a well-formed sitemap urlset", () => {
    const sitemap = buildSitemapXml();

    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(sitemap).toContain("</urlset>");
  });
});

describe("app URL edge cases", () => {
  it("throws when the app URL is not configured (fails loud)", () => {
    delete process.env.NUXT_PUBLIC_APP_URL;

    expect(() => buildOpenApiJson()).toThrow(/NUXT_PUBLIC_APP_URL/);
    expect(() => buildLlmsTxt()).toThrow(/NUXT_PUBLIC_APP_URL/);
    expect(() => buildSitemapXml()).toThrow(/NUXT_PUBLIC_APP_URL/);
  });

  it("never doubles the slash when the app URL has a trailing slash", () => {
    process.env.NUXT_PUBLIC_APP_URL = `${TEST_APP_URL}/`;

    expect(buildSitemapXml()).toContain(`<loc>${TEST_APP_URL}/docs</loc>`);
    expect(buildSitemapXml()).not.toContain(`${TEST_APP_URL}//`);
    expect(buildLlmsTxt()).not.toContain(`${TEST_APP_URL}//`);
  });

  it("keeps the openapi spec parseable when the app URL has reserved characters", () => {
    for (const origin of [
      'https://example.com/"break',
      "https://example.com/$'",
      "https://example.com/$&",
    ]) {
      process.env.NUXT_PUBLIC_APP_URL = origin;
      expect(() => JSON.parse(buildOpenApiJson()), origin).not.toThrow();
    }
  });

  it("does not reinterpret a $-sequence in the origin as a replacement pattern", () => {
    process.env.NUXT_PUBLIC_APP_URL = "https://example.com/$&x";

    // With a string replacement, `$&` expands to the matched placeholder text,
    // reinjecting `{{APP_URL}}`; the replacer function keeps it literal. llms.txt
    // does no escaping, so the origin survives verbatim.
    const llms = buildLlmsTxt();
    expect(llms).not.toContain("{{APP_URL}}");
    expect(llms).toContain("[Documentation](https://example.com/$&x/docs)");
  });

  it("entity-escapes a reserved character in sitemap loc values", () => {
    process.env.NUXT_PUBLIC_APP_URL = "https://example.com/a&b";

    expect(buildSitemapXml()).toContain("https://example.com/a&amp;b/docs");
    expect(buildSitemapXml()).not.toContain("a&b/docs");
  });
});
