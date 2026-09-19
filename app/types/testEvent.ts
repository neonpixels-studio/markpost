// The test-event modal's contract, shared by TestEventModal.vue (which
// renders the payload editor and result) and the sources page (which drives
// the flow) so a change to the shape can't leave the two out of sync.
import type { TestEventResult } from "~/composables/useSources";

export interface TestEventSource {
  uuid: string;
  name: string;
}

export interface TestEventState {
  source: TestEventSource;
  // Set once a send completes successfully; the page clears this back to
  // null whenever the modal reopens for a (possibly different) source, so a
  // stale result can never be shown against the wrong send.
  result: TestEventResult | null;
}
