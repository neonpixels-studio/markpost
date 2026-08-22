import { describe, expect, it } from "vitest";
import {
  PROTECTED_RESOURCE,
  PROTECTED_RESOURCE_PATH,
  SCOPE_NAMES,
  buildProtectedResourceMetadata,
} from "../../../server/utils/protectedResource";

describe("protectedResource", () => {
  it("serves metadata at the RFC 9728 well-known path", () => {
    expect(PROTECTED_RESOURCE_PATH).toBe(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("builds RFC 9728 metadata for the API resource", () => {
    const metadata = buildProtectedResourceMetadata();

    expect(metadata.resource).toBe(PROTECTED_RESOURCE);
    expect(metadata.resource).toMatch(/\/api$/);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
    expect(metadata.resource_documentation).toMatch(/\/openapi\.json$/);
  });

  it("declares a read/write scope catalog", () => {
    const metadata = buildProtectedResourceMetadata();

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
