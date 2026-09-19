import { describe, expect, it } from "vitest";
import {
  PROTECTED_RESOURCE_PATH,
  SCOPE_NAMES,
  buildProtectedResourceMetadata,
  isScopeName,
  parseScopes,
} from "../../../server/utils/protectedResource";

const APP_URL = "https://custom-domain.example.com";

describe("protectedResource", () => {
  it("serves metadata at the RFC 9728 well-known path", () => {
    expect(PROTECTED_RESOURCE_PATH).toBe(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("builds RFC 9728 metadata from the supplied app URL", () => {
    const metadata = buildProtectedResourceMetadata(APP_URL);

    expect(metadata.resource).toBe(`${APP_URL}/api`);
    expect(metadata.resource_documentation).toBe(`${APP_URL}/openapi.json`);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("does not advertise the hardcoded Netlify preview host", () => {
    const metadata = buildProtectedResourceMetadata(APP_URL);

    expect(metadata.resource).not.toContain("dh-markpost.netlify.app");
    expect(metadata.resource_documentation).not.toContain(
      "dh-markpost.netlify.app",
    );
  });

  it("declares a read/write scope catalog", () => {
    const metadata = buildProtectedResourceMetadata(APP_URL);

    expect(metadata.scopes_supported).toEqual(SCOPE_NAMES);
    expect(metadata.scopes_supported).toContain("records:read");
    expect(metadata.scopes_supported).toContain("records:write");
    expect(metadata.scopes_supported).toContain("account:write");
    // Every scope is a `resource:action` pair.
    for (const scope of metadata.scopes_supported) {
      expect(scope).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });
});

describe("isScopeName", () => {
  it("is true for every recognized scope", () => {
    for (const scope of SCOPE_NAMES) {
      expect(isScopeName(scope)).toBe(true);
    }
  });

  it("is false for an unrecognized string", () => {
    expect(isScopeName("nonsense")).toBe(false);
  });

  it("is false for a non-string value", () => {
    expect(isScopeName(42)).toBe(false);
    expect(isScopeName(null)).toBe(false);
    expect(isScopeName(undefined)).toBe(false);
  });
});

describe("parseScopes", () => {
  it("returns null for null (full access, the mint-time default)", () => {
    expect(parseScopes(null)).toBeNull();
  });

  it("returns null for undefined (a legacy row with no scopes column set)", () => {
    expect(parseScopes(undefined)).toBeNull();
  });

  it("returns the array unchanged when every entry is a recognized scope", () => {
    expect(parseScopes(["records:read", "records:write"])).toEqual([
      "records:read",
      "records:write",
    ]);
  });

  it("drops unrecognized entries rather than trusting them", () => {
    expect(parseScopes(["records:read", "nonsense"])).toEqual(["records:read"]);
  });

  it("de-duplicates repeated scope names", () => {
    expect(parseScopes(["records:read", "records:read"])).toEqual([
      "records:read",
    ]);
  });

  it("returns an explicit empty array (deny, not full access) when nothing is recognized", () => {
    expect(parseScopes(["nonsense", "also-nonsense"])).toEqual([]);
  });

  it("returns an explicit empty array (deny, not full access) for a non-array, non-null value", () => {
    expect(parseScopes("records:read")).toEqual([]);
    expect(parseScopes(42)).toEqual([]);
  });
});
