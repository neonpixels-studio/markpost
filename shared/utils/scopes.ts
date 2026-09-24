// OAuth-style scope catalog for the Markpost API. Shared so the server
// (server/utils/protectedResource.ts RFC 9728 metadata, server/utils/auth.ts
// requireScope, server/api/tokens/index.post.ts mint-time allowlist) and the
// client (app/components/settings/TokenScopeFields.vue mint-form scope
// picker, SetTokens.vue token-list scope display) read the exact same list —
// a scope added or renamed here can never drift between what the mint form
// offers and what the server actually enforces.

type Scope = {
  name: string;
  description: string;
};

// One read + one write scope per resource, plus read-only resources. Endpoint
// mapping (documented in /openapi.json):
//   records:read   GET /records, /records/{uuid}, /records/export, /records/stats
//   records:write  POST/DELETE /records, PATCH /records/{uuid}
//   sources:read   GET /sources
//   sources:write  POST /sources, PATCH/DELETE /sources/{uuid}, rotate-secret,
//                  test
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
    description:
      "Create, update, delete, test, and rotate secrets for sources.",
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
// calls it), the mint-time allowlist (server/api/tokens/index.post.ts), and
// the mint-form scope picker (TokenScopeFields.vue) can never drift from the
// RFC 9728 metadata catalog above.
export type ScopeName = (typeof SCOPES)[number]["name"];

export const SCOPE_NAMES: ScopeName[] = SCOPES.map((scope) => scope.name);

export function isScopeName(value: unknown): value is ScopeName {
  return SCOPE_NAMES.includes(value as ScopeName);
}
