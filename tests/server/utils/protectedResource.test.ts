import { describe, expect, it } from "vitest";
import {
  PROTECTED_RESOURCE_PATH,
  SCOPE_NAMES,
  buildProtectedResourceMetadata,
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
