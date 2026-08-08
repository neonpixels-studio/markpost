// Canonical list of source types. Source creation
// (server/api/sources/index.post.ts) and the records list filter
// (server/api/records/index.get.ts) both import this so the set of types the
// API accepts and the set the filter recognizes can never drift apart. Nuxt
// auto-resolves `shared/` for both the app and server layers, so this is the
// one place that may define them.
//
// RSS/Atom is intentionally excluded: there is no polling infrastructure
// (scheduler, dedup, fetch cadence) anywhere in the codebase to service an
// "rss" source, so creating one would silently never ingest a single record.
// See https://github.com/neonpixels-studio/markpost/issues/116.
export const SOURCE_TYPES = [
  "webhook",
  "email",
  "stripe",
  "github",
  "zapier",
  "shortcuts",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}
