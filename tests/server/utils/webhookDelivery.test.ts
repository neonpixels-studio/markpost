import { describe, expect, it } from "vitest";
import {
  extractDeliveryId,
  GITHUB_DELIVERY_HEADER,
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
