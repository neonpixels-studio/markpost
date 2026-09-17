// The default synthetic payload for a source's "send test event" action
// (server/api/sources/[uuid]/test.post.ts). Shared so the payload the
// TestEventModal pre-fills for the user to review/edit is byte-identical to
// what the server would generate on its own if no payload were supplied —
// there is exactly one definition of "the default test event", not one per
// layer.
export function buildTestEventSamplePayload(): Record<string, unknown> {
  return {
    title: "Test event from markpost",
    content:
      "This is a test event sent from the Sources page to check signature verification and field mapping before a real delivery arrives.",
    tags: ["test"],
    created: new Date().toISOString(),
  };
}
