import { describe, expect, it } from "vitest";
import {
  extractDeliveryId,
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  isGithubPingEvent,
} from "../../../server/utils/webhookDelivery";

describe("extractDeliveryId", () => {
  it("reads a Stripe event id from the payload `id` field", () => {
    const id = extractDeliveryId("stripe", {}, { id: "evt_123" });
    expect(id).toBe("evt_123");
  });

  it("trims surrounding whitespace on a Stripe event id", () => {
    const id = extractDeliveryId("stripe", {}, { id: "  evt_123  " });
    expect(id).toBe("evt_123");
  });

  it("returns null for a Stripe payload with no id", () => {
    const id = extractDeliveryId("stripe", {}, { type: "charge.succeeded" });
    expect(id).toBeNull();
  });

  it("returns null for a Stripe payload whose id is not a string", () => {
    const id = extractDeliveryId("stripe", {}, { id: 42 });
    expect(id).toBeNull();
  });

  it("returns null for an over-long id so a hostile value degrades to a normal insert", () => {
    const id = extractDeliveryId("stripe", {}, { id: "e".repeat(256) });
    expect(id).toBeNull();
  });

  it("accepts an id at the 255-char boundary", () => {
    const boundary = "e".repeat(255);
    const id = extractDeliveryId("stripe", {}, { id: boundary });
    expect(id).toBe(boundary);
  });

  it("reads a GitHub delivery id from the X-GitHub-Delivery header", () => {
    const id = extractDeliveryId(
      "github",
      { [GITHUB_DELIVERY_HEADER]: "gh-1" },
      {},
    );
    expect(id).toBe("gh-1");
  });

  it("normalizes the provider so a stored `GitHub ` still dispatches", () => {
    const id = extractDeliveryId(
      "GitHub ",
      { [GITHUB_DELIVERY_HEADER]: "gh-2" },
      {},
    );
    expect(id).toBe("gh-2");
  });

  it("returns null for a GitHub delivery with no delivery header", () => {
    const id = extractDeliveryId("github", {}, {});
    expect(id).toBeNull();
  });

  it("returns null for a slug-only source (no provider)", () => {
    const id = extractDeliveryId(null, {}, { id: "evt_ignored" });
    expect(id).toBeNull();
  });

  it("returns null for a shared-secret provider with no delivery id", () => {
    const id = extractDeliveryId("zapier", {}, { id: "evt_ignored" });
    expect(id).toBeNull();
  });
});

describe("isGithubPingEvent", () => {
  // GitHub's real ping payload: a `zen` string plus `hook_id` (and more
  // metadata this check doesn't look at).
  const PING_PAYLOAD = { zen: "Design for failure.", hook_id: 12345 };
  const PING_HEADERS = { [GITHUB_EVENT_HEADER]: "ping" };

  it("returns true for a GitHub source with the ping header and a ping-shaped body", () => {
    expect(isGithubPingEvent("github", PING_HEADERS, PING_PAYLOAD)).toBe(true);
  });

  it("normalizes the provider so a stored `GitHub ` still matches", () => {
    expect(isGithubPingEvent("GitHub ", PING_HEADERS, PING_PAYLOAD)).toBe(true);
  });

  it("returns false for a non-ping GitHub event", () => {
    expect(
      isGithubPingEvent(
        "github",
        { [GITHUB_EVENT_HEADER]: "push" },
        PING_PAYLOAD,
      ),
    ).toBe(false);
  });

  it("returns false when the event header is missing", () => {
    expect(isGithubPingEvent("github", {}, PING_PAYLOAD)).toBe(false);
  });

  it("normalizes the event header so surrounding whitespace/case still matches", () => {
    expect(
      isGithubPingEvent(
        "github",
        { [GITHUB_EVENT_HEADER]: "Ping " },
        PING_PAYLOAD,
      ),
    ).toBe(true);
  });

  it("returns false for a non-GitHub provider even if the header says ping", () => {
    expect(isGithubPingEvent("zapier", PING_HEADERS, PING_PAYLOAD)).toBe(false);
  });

  it("returns false for a slug-only source (no provider)", () => {
    expect(isGithubPingEvent(null, PING_HEADERS, PING_PAYLOAD)).toBe(false);
  });

  // Security-critical case: X-Hub-Signature-256 covers only the body, not
  // headers, so a correctly signed real delivery (e.g. push) must not be
  // discarded just because something between GitHub and this app rewrote
  // x-github-event to "ping" — the body-shape check is what stops that.
  it("returns false for a ping header on a non-ping-shaped (real delivery) body", () => {
    expect(isGithubPingEvent("github", PING_HEADERS, { ref: "main" })).toBe(
      false,
    );
  });

  it("returns false when the body has `zen` but no `hook_id`", () => {
    expect(
      isGithubPingEvent("github", PING_HEADERS, { zen: "Design for failure." }),
    ).toBe(false);
  });

  it("returns false when the body's `zen` is not a string", () => {
    expect(
      isGithubPingEvent("github", PING_HEADERS, { zen: 1, hook_id: 12345 }),
    ).toBe(false);
  });
});
