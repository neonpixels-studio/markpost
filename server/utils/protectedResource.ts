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

type Scope = {
  name: string;
  description: string;
};

// One read + one write scope per resource, plus read-only resources. Endpoint
// mapping (documented in /openapi.json):
//   records:read   GET /records, /records/{uuid}, /records/export, /records/stats
//   records:write  POST/DELETE /records, PATCH /records/{uuid}
//   sources:read   GET /sources
//   sources:write  POST /sources, PATCH/DELETE /sources/{uuid}, rotate-secret
//   events:read    GET /events, /events/export
//   tokens:read    GET /tokens
//   tokens:write   POST /tokens, DELETE /tokens/{id}
//   settings:read  GET /settings
//   settings:write PUT /settings
//   billing:read   GET /billing/usage
//   billing:write  POST /billing/checkout, /billing/portal
//   account:write  DELETE /account
export const SCOPES = [
  { name: "records:read", description: "Read records and record statistics." },
  { name: "records:write", description: "Create, update, and delete records." },
  { name: "sources:read", description: "List connected sources." },
  {
    name: "sources:write",
    description: "Create, update, delete, and rotate secrets for sources.",
  },
  { name: "events:read", description: "Read the activity event log." },
  { name: "tokens:read", description: "List API tokens." },
  { name: "tokens:write", description: "Mint and revoke API tokens." },
  { name: "settings:read", description: "Read sync and vault settings." },
  { name: "settings:write", description: "Update sync and vault settings." },
  { name: "billing:read", description: "Read subscription and usage." },
  {
    name: "billing:write",
    description: "Start checkout and open the billing portal.",
  },
  { name: "account:write", description: "Delete the account." },
] as const satisfies readonly Scope[];

// Literal union of every recognized scope name, derived from SCOPES so the
// enforcement side (server/utils/auth.ts requireScope, every handler that
// calls it) and the mint-time allowlist (server/api/tokens/index.post.ts)
// can never drift from the RFC 9728 metadata catalog below.
export type ScopeName = (typeof SCOPES)[number]["name"];

export const SCOPE_NAMES: ScopeName[] = SCOPES.map((scope) => scope.name);

export function isScopeName(value: unknown): value is ScopeName {
  return SCOPE_NAMES.includes(value as ScopeName);
}

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
