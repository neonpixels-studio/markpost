// RFC 9728 (OAuth 2.0 Protected Resource Metadata) for the Markpost API.
//
// This declares the resource's supported OAuth scopes machine-readably so an
// agent can learn what named permissions the API recognizes without reading
// prose. The scopes describe intent per resource + action and are enforced:
// every handler calls server/utils/auth.ts requireScope with the scope from
// the endpoint mapping below. A token minted with no `scopes` (mint-time
// default, and every token minted before scoping existed) is full-access —
// see server/db/schema.ts apiTokens.scopes and requireScope's NULL handling.

// Path segments appended to the configured app URL to form the resource id and
// its documentation link, per RFC 9728. The caller resolves the app URL so this
// stays a pure builder, testable without the environment.
const API_BASE_PATH = "/api";
const OPENAPI_DOCUMENTATION_PATH = "/openapi.json";

// RFC 9728 default well-known location for a protected resource's metadata.
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

export const PROTECTED_RESOURCE_CONTENT_TYPE =
  "application/json; charset=utf-8";

// The scope catalog itself lives in shared/utils/scopes.ts, the single
// source both this server-only module and the client's mint-form scope
// picker (TokenScopeFields.vue) read from, the same way MIN/MAX_TOKEN_EXPIRY_
// DAYS live in shared/utils/tokens.ts rather than being re-exported from a
// server file. Import directly from there in any new caller instead of from
// this file.
import { SCOPE_NAMES, isScopeName, type ScopeName } from "#shared/utils/scopes";

// Single trust boundary for the persisted `scopes` column (server/db/
// schema.ts apiTokens.scopes is a plain text[] with no CHECK constraint).
// Called everywhere a stored value is read back — server/middleware/auth.ts
// (populating event.context.tokenScopes) and server/api/tokens/index.get.ts
// and index.post.ts (serializing the resource) — so a scope name later
// retired from SCOPES can never silently keep working, and a row that is
// somehow neither NULL nor a valid array can never be misread as full
// access. NULL stays NULL (full access, the documented default); a
// non-array or an array containing nothing recognizable comes back as `[]`
// (an explicit deny, since only a genuine NULL column value means
// unrestricted); a valid array is de-duplicated.
export function parseScopes(value: unknown): ScopeName[] | null {
  if (value == null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter(isScopeName)));
}

// RFC 9728 §3. `authorization_servers` is intentionally omitted: Markpost does
// not yet front the API with an OAuth authorization server, and RFC 9728 makes
// that member optional. `resource_documentation` points agents at the full
// OpenAPI surface.
export function buildProtectedResourceMetadata(appUrl: string) {
  return {
    resource: `${appUrl}${API_BASE_PATH}`,
    resource_name: "Markpost API",
    scopes_supported: SCOPE_NAMES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${appUrl}${OPENAPI_DOCUMENTATION_PATH}`,
  };
}
