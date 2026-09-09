// Canonical record status list, plus the per-endpoint bulk batch caps.
// server/db/schema.ts, the records API handlers (index.delete.ts,
// index.patch.ts), and the inbox composable (useRecords.ts) all import from
// here so client-side validation/UI caps and server-side enforcement can
// never drift apart. Nuxt auto-resolves `shared/` for both the app and
// server layers, so this is the one place that may define them.
export const RECORD_STATUSES = ["synced", "pending", "error"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

// DELETE and PATCH currently share one cap. They are exported separately
// (rather than a single constant) so the endpoints can diverge later without
// a rename — if they do, BULK_ACTION_MAX_BATCH_SIZE in
// app/composables/useRecords.ts already takes the min of the two and needs
// no change.
export const MAX_DELETE_BATCH_SIZE = 100;
export const MAX_UPDATE_BATCH_SIZE = 100;
