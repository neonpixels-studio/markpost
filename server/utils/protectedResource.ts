// RFC 9728 (OAuth 2.0 Protected Resource Metadata) for the Markpost API.
//
// This declares the resource's supported OAuth scopes machine-readably so an
// agent can learn what named permissions the API recognizes without reading
// prose. The scopes describe intent per resource + action; enforcement is not
// yet wired up (today's bearer tokens are all-access), so this metadata is a
// forward-looking contract, not a claim that requests are currently scoped.

import { SITE_URL } from "./agentContent";

// The resource identifier this metadata describes: the API base, per RFC 9728.
export const PROTECTED_RESOURCE = `${SITE_URL}/api`;

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
export const SCOPES: Scope[] = [
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
];

export const SCOPE_NAMES: string[] = SCOPES.map((scope) => scope.name);

// RFC 9728 §3. `authorization_servers` is intentionally omitted: Markpost does
// not yet front the API with an OAuth authorization server, and RFC 9728 makes
// that member optional. `resource_documentation` points agents at the full
// OpenAPI surface.
export function buildProtectedResourceMetadata() {
  return {
    resource: PROTECTED_RESOURCE,
    resource_name: "Markpost API",
    scopes_supported: SCOPE_NAMES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${SITE_URL}/openapi.json`,
  };
}
