import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every authenticated handler must gate on a scope (server/utils/auth.ts
// requireScope), or a scoped API token silently gets full access to that
// route. requireScope's NULL-check makes the gate itself easy to add per
// handler, but nothing short of a test catches a handler that forgets to
// call it (see server/api/records/index.get.ts, which doesn't even import
// requireScope — it relies on Nitro's server-utils auto-import, so a missing
// call would not be a compile error either). This test statically greps
// every server/api handler file so a future PR that adds an authenticated
// route without a matching requireScope call fails CI instead of shipping a
// silent bypass.
//
// The map below is the single source of truth for "route -> required
// scope" and must stay in sync with the RFC 9728 endpoint mapping documented
// in server/utils/protectedResource.ts.
const EXPECTED_HANDLER_SCOPES: Record<string, string> = {
  "account/index.delete.ts": "account:write",
  "billing/checkout.post.ts": "billing:write",
  "billing/portal.post.ts": "billing:write",
  "billing/usage.get.ts": "billing:read",
  "events/export.get.ts": "events:read",
  "events/index.get.ts": "events:read",
  "records/[uuid].get.ts": "records:read",
  "records/[uuid].patch.ts": "records:write",
  "records/export.get.ts": "records:read",
  "records/index.delete.ts": "records:write",
  "records/index.get.ts": "records:read",
  "records/index.patch.ts": "records:write",
  "records/index.post.ts": "records:write",
  "records/stats.get.ts": "records:read",
  "settings/index.get.ts": "settings:read",
  "settings/index.put.ts": "settings:write",
  "sources/[uuid].delete.ts": "sources:write",
  "sources/[uuid].get.ts": "sources:read",
  "sources/[uuid].patch.ts": "sources:write",
  "sources/[uuid]/rotate-secret.post.ts": "sources:write",
  "sources/index.get.ts": "sources:read",
  "sources/index.post.ts": "sources:write",
  "tokens/[id].delete.ts": "tokens:write",
  "tokens/index.get.ts": "tokens:read",
  "tokens/index.post.ts": "tokens:write",
};

// Public webhook/hook handlers bypass the auth middleware entirely (verified
// by their own signature — see server/middleware/auth.ts's path bypass
// list), so they never call requireUser and are exempt from this coverage
// check rather than missing entries in EXPECTED_HANDLER_SCOPES.
const PUBLIC_HANDLERS = new Set([
  "billing/webhook.post.ts",
  "hooks/[slug].post.ts",
  "webhooks/clerk.post.ts",
]);

const API_DIR = join(import.meta.dirname, "../../../server/api");

function listHandlerFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true })
    .map((entry) => entry.toString())
    .filter((entry) => entry.endsWith(".ts"));
}

function readHandlerSource(relativePath: string): string {
  return readFileSync(join(API_DIR, relativePath), "utf8");
}

function callsRequireUser(source: string): boolean {
  return source.includes("requireUser(event)");
}

function requireScopeCallFor(relativePath: string): string | undefined {
  const scope = EXPECTED_HANDLER_SCOPES[relativePath];
  return scope && `requireScope(event, "${scope}");`;
}

describe("server/api scope coverage", () => {
  const handlerFiles = listHandlerFiles();
  const authenticatedHandlers = handlerFiles.filter((relativePath) =>
    callsRequireUser(readHandlerSource(relativePath)),
  );

  it("finds at least one authenticated handler (sanity check for the file walk)", () => {
    expect(authenticatedHandlers.length).toBeGreaterThan(0);
  });

  it("every authenticated handler has an entry in EXPECTED_HANDLER_SCOPES", () => {
    const missingEntries = authenticatedHandlers.filter(
      (relativePath) => !(relativePath in EXPECTED_HANDLER_SCOPES),
    );

    expect(missingEntries).toEqual([]);
  });

  it("every EXPECTED_HANDLER_SCOPES entry still exists on disk and still authenticates", () => {
    const staleEntries = Object.keys(EXPECTED_HANDLER_SCOPES).filter(
      (relativePath) => !authenticatedHandlers.includes(relativePath),
    );

    expect(staleEntries).toEqual([]);
  });

  it("no authenticated handler is left off both the expected map and the public exemption list", () => {
    const unaccountedFor = handlerFiles.filter((relativePath) => {
      const isExempt = PUBLIC_HANDLERS.has(relativePath);
      const isCovered = relativePath in EXPECTED_HANDLER_SCOPES;
      return (
        !isExempt &&
        !isCovered &&
        callsRequireUser(readHandlerSource(relativePath))
      );
    });

    expect(unaccountedFor).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_HANDLER_SCOPES))(
    "%s calls requireScope with its documented scope",
    (relativePath, scope) => {
      const source = readHandlerSource(relativePath);
      expect(source).toContain(requireScopeCallFor(relativePath) ?? scope);
    },
  );
});
