import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// server/middleware/auth.ts's default export is `defineEventHandler(...)`,
// invoked at module load time, so importing it (purely to read its exported
// path constants below) needs the same global stub every other test that
// imports a Nitro handler module already uses.
vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { BILLING_WEBHOOK_PATH, CLERK_WEBHOOK_PATH, HOOKS_PATH_PREFIX } =
  await import("../../../server/middleware/auth");

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
// by their own signature), so they never call requireUser and are exempt
// from this coverage check rather than missing entries in
// EXPECTED_HANDLER_SCOPES. Cross-checked below against the middleware's own
// exported bypass-path constants, so this list can't silently drift from the
// real security-relevant decision it claims to mirror.
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

// Strips comments before every check below matches against source text, so
// a call that was merely commented out (rather than genuinely removed) is
// not mistaken for a live one — the whole point of this file is to catch a
// gate that looks present but never runs.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readHandlerSource(relativePath: string): string {
  const raw = readFileSync(join(API_DIR, relativePath), "utf8");
  return stripComments(raw);
}

function requireScopeCallFor(relativePath: string): string {
  return `requireScope(event, "${EXPECTED_HANDLER_SCOPES[relativePath]}");`;
}

// A Nitro filename maps to its route by stripping the method suffix and
// prefixing "/api/" — "hooks/[slug].post.ts" -> "/api/hooks/[slug]",
// "billing/webhook.post.ts" -> "/api/billing/webhook".
function handlerRoutePath(relativePath: string): string {
  const withoutMethodSuffix = relativePath.replace(
    /\.(get|post|put|patch|delete)\.ts$/,
    "",
  );
  return `/api/${withoutMethodSuffix}`;
}

describe("server/api scope coverage", () => {
  const handlerFiles = listHandlerFiles();

  it("finds at least one handler file (sanity check for the file walk)", () => {
    expect(handlerFiles.length).toBeGreaterThan(0);
  });

  // Deliberately does NOT gate on "calls requireUser(event)" the way the
  // per-scope checks below do: a handler that reads event.context.userId
  // directly, or authenticates through some future helper, would be
  // invisible to a requireUser-string filter and silently ship unscoped.
  // Every single file must be accounted for by name, with no way to opt out
  // by construction.
  it("every handler file is classified as either scoped or public", () => {
    const unclassified = handlerFiles.filter(
      (relativePath) =>
        !(relativePath in EXPECTED_HANDLER_SCOPES) &&
        !PUBLIC_HANDLERS.has(relativePath),
    );

    expect(unclassified).toEqual([]);
  });

  it("every EXPECTED_HANDLER_SCOPES and PUBLIC_HANDLERS entry still exists on disk", () => {
    const staleEntries = [
      ...Object.keys(EXPECTED_HANDLER_SCOPES),
      ...PUBLIC_HANDLERS,
    ].filter((relativePath) => !handlerFiles.includes(relativePath));

    expect(staleEntries).toEqual([]);
  });

  it("every scoped handler still calls requireUser (still authenticates)", () => {
    const noLongerAuthenticated = Object.keys(EXPECTED_HANDLER_SCOPES).filter(
      (relativePath) =>
        !readHandlerSource(relativePath).includes("requireUser(event)"),
    );

    expect(noLongerAuthenticated).toEqual([]);
  });

  it("every public exemption is actually bypassed by the auth middleware", () => {
    const notBypassed = [...PUBLIC_HANDLERS].filter((relativePath) => {
      const routePath = handlerRoutePath(relativePath);
      const isBypassed =
        routePath.startsWith(HOOKS_PATH_PREFIX) ||
        routePath === BILLING_WEBHOOK_PATH ||
        routePath === CLERK_WEBHOOK_PATH;
      return !isBypassed;
    });

    expect(notBypassed).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_HANDLER_SCOPES))(
    "%s calls requireScope with its documented scope",
    (relativePath) => {
      const source = readHandlerSource(relativePath);
      expect(source).toContain(requireScopeCallFor(relativePath));
    },
  );
});
