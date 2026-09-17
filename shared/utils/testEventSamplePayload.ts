// The default synthetic payload for a source's "send test event" action
// (server/api/sources/[uuid]/test.post.ts). Shared so the payload
// TestEventModal pre-fills for the user to review/edit has the same shape and
// content as what the server would generate on its own if no payload were
// supplied — there is exactly one definition of "the default test event", not
// one per layer. Not byte-identical between the two calls: `created` reads
// each layer's own clock at call time (the modal's the moment it mounts, the
// server's the moment a request omits `payload`), which is fine — it's a
// sample value, not something either side depends on matching exactly.
export function buildTestEventSamplePayload(): Record<string, unknown> {
  return {
    title: "Test event from markpost",
    content:
      "This is a test event sent from the Sources page to check signature verification and field mapping before a real delivery arrives.",
    tags: ["test"],
    created: new Date().toISOString(),
  };
}
