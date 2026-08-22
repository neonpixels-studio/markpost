import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCOPE_NAMES } from "../../server/utils/protectedResource";

const specPath = resolve(process.cwd(), "public/openapi.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

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

describe("public/openapi.json", () => {
  it("is a valid OpenAPI 3.1 document with the expected metadata", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toBe("Markpost API");
    expect(spec.info?.version).toBeTypeOf("string");
    expect(spec.servers?.[0]?.url).toBe("https://dh-markpost.netlify.app/api");
  });

  it("declares the bearer security scheme globally", () => {
    const scheme = spec.components?.securitySchemes?.bearerAuth;
    expect(scheme).toMatchObject({ type: "http", scheme: "bearer" });
    expect(spec.security).toContainEqual({ bearerAuth: [] });
  });

  it("documents exactly the REST endpoints the server exposes", () => {
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
    for (const [path, method] of PUBLIC_OPERATIONS) {
      expect(spec.paths[path][method].security).toEqual([]);
    }
  });

  it("catalogs the same scopes as the protected-resource metadata", () => {
    expect(Object.keys(spec["x-scopes"]).sort()).toEqual(
      [...SCOPE_NAMES].sort(),
    );
  });

  it("has no dangling internal $refs", () => {
    const refs = collectRefs(spec).filter((ref) => ref.startsWith("#/"));
    expect(refs.length).toBeGreaterThan(0);

    const dangling = refs.filter(
      (ref) => resolvePointer(spec, ref) === undefined,
    );
    expect(dangling).toEqual([]);
  });
});
