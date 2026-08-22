import { describe, expect, it } from "vitest";
import { ApiError } from "../../../server/utils/errors";
import {
  MAX_WEBHOOK_BODY_BYTES,
  assertBodyWithinLimit,
  assertContentLengthWithinLimit,
} from "../../../server/utils/webhookBodyLimit";

function expectPayloadTooLarge(run: () => void): void {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({
    statusCode: 413,
    errors: [
      {
        status: "413",
        title: "Payload Too Large",
        detail: expect.stringContaining(String(MAX_WEBHOOK_BODY_BYTES)),
      },
    ],
  });
}

describe("assertContentLengthWithinLimit", () => {
  it("passes when the header is absent (backstop handles the real bytes)", () => {
    expect(() => assertContentLengthWithinLimit(undefined)).not.toThrow();
  });

  it("passes when the header is non-numeric", () => {
    expect(() => assertContentLengthWithinLimit("not-a-number")).not.toThrow();
  });

  it.each(["-1", "1.5", "Infinity"])(
    "defers to the byte check for an invalid Content-Length (%s)",
    (header) => {
      expect(() => assertContentLengthWithinLimit(header)).not.toThrow();
    },
  );

  it("passes when the declared length is exactly the maximum", () => {
    expect(() =>
      assertContentLengthWithinLimit(String(MAX_WEBHOOK_BODY_BYTES)),
    ).not.toThrow();
  });

  it("throws 413 when the declared length exceeds the maximum", () => {
    expectPayloadTooLarge(() =>
      assertContentLengthWithinLimit(String(MAX_WEBHOOK_BODY_BYTES + 1)),
    );
  });
});

describe("assertBodyWithinLimit", () => {
  it("passes for an empty body", () => {
    expect(() => assertBodyWithinLimit("")).not.toThrow();
  });

  it("passes for a body exactly at the byte maximum", () => {
    const body = "a".repeat(MAX_WEBHOOK_BODY_BYTES);
    expect(() => assertBodyWithinLimit(body)).not.toThrow();
  });

  it("throws 413 for a body one byte over the maximum", () => {
    const body = "a".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    expectPayloadTooLarge(() => assertBodyWithinLimit(body));
  });

  it("measures bytes, not characters, for multi-byte content", () => {
    // "€" is 3 bytes in UTF-8, so a string of these overshoots the byte cap
    // well before its character length would.
    const multiByteChar = "€";
    const charCount = Math.ceil(MAX_WEBHOOK_BODY_BYTES / 3) + 1;
    const body = multiByteChar.repeat(charCount);
    expect(body.length).toBeLessThan(MAX_WEBHOOK_BODY_BYTES);
    expectPayloadTooLarge(() => assertBodyWithinLimit(body));
  });
});
