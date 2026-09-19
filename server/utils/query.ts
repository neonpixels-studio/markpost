// h3's getQuery() returns a string[] when a query key is repeated (e.g.
// ?filter[source]=webhook&filter[source]=email). A repeated filter key
// isn't necessarily an error — one repeated filter[status]/filter[q] value
// is silently ignored today, but a repeated filter[source] or events
// filter[kind] would otherwise throw a misleading "must be one of" error
// even though every value the caller sent was valid. Take the first value,
// the same "duplicate key" convention most query-string parsers use.
export function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
