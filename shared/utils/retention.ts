// Activity events are retained for EVENT_RETENTION_DAYS, after which
// server/utils/eventRetention.ts prunes them (that file documents why the
// events table needs a bound and how the opportunistic sweep works).
//
// The constant lives here in shared/ — not in the server util that enforces it
// — so the activity UI can display the exact window it deletes on, the same way
// EXPORT_ROW_LIMIT sits beside the export copy that quotes it
// (shared/utils/export.ts). Nuxt auto-resolves shared/ for both layers; import
// via `#shared`, never a relative path. server/utils/eventRetention.ts imports
// this same constant so the number the server prunes on and the number the UI
// shows can never drift apart.
export const EVENT_RETENTION_DAYS = 90;

// The persistent notice the activity page shows so users know history is not
// kept forever. Title kept separate from the body so the page can render it
// through the shared AppAlert (title + slot) like every other notice. Derived
// from EVENT_RETENTION_DAYS so it can never drift from the pruned window.
export const RETENTION_NOTICE_TITLE = `${EVENT_RETENTION_DAYS}-day retention`;

// A function, not a pre-baked string, so the day count in the copy is derived
// from EVENT_RETENTION_DAYS at its single call site and can never be edited out
// of sync with the value the server actually prunes on.
export function retentionNoticeMessage(
  retentionDays: number = EVENT_RETENTION_DAYS,
): string {
  return `Activity older than ${retentionDays} days is automatically removed. Export your log to keep a copy.`;
}
