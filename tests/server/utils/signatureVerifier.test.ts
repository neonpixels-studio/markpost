import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
  verifyGithubSignature,
  verifySharedSecret,
  hashSharedSecret,
  verifyProviderSignature,
  generateProviderSecret,
  isSecretBackedProvider,
  isManualSecretProvider,
  isHashedStorageProvider,
  buildStripeSignatureHeader,
  buildGithubSignatureHeader,
  SECRET_BACKED_PROVIDERS,
  MANUAL_SECRET_PROVIDERS,
  type VerificationResult,
} from "../../../server/utils/signatureVerifier";
import { SHARED_SECRET_HEADER } from "#shared/utils/webhookSecrets";
import { buildValidStripeHeader, buildValidGithubHeader } from "../helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function expectFailureWithReason(
  result: VerificationResult,
  pattern: RegExp,
): void {
  expect(result.ok).toBe(false);
  expect((result as { ok: false; reason: string }).reason).toMatch(pattern);
}

describe("parseStripeSignatureHeader", () => {
  it("parses a valid header into timestamp and signatures", () => {
    const result = parseStripeSignatureHeader(
      "t=1234567890,v1=abc123,v1=def456",
    );
    expect(result).toEqual({
      timestamp: "1234567890",
      signatures: ["abc123", "def456"],
    });
  });

  it("returns null when timestamp is missing", () => {
    expect(parseStripeSignatureHeader("v1=abc123")).toBeNull();
  });

  it("returns null when v1 signatures are missing", () => {
    expect(parseStripeSignatureHeader("t=1234567890")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseStripeSignatureHeader("")).toBeNull();
  });

  it("ignores unknown prefixes", () => {
    const result = parseStripeSignatureHeader("t=9999,v2=othersig,v1=valid");
    expect(result).toEqual({ timestamp: "9999", signatures: ["valid"] });
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const rawBody = JSON.stringify({ event: "payment.created", amount: 100 });

  it("returns ok: true for a valid fresh signature", () => {
    const header = buildValidStripeHeader(rawBody, secret);
    const result = verifyStripeSignature(header, rawBody, secret);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false for a missing/malformed header", () => {
    const result = verifyStripeSignature("garbage", rawBody, secret);
    expect(result.ok).toBe(false);
  });

  it("returns ok: false when the signature does not match", () => {
    const header = buildValidStripeHeader(rawBody, "wrong_secret");
    const result = verifyStripeSignature(header, rawBody, secret);
    expectFailureWithReason(result, /mismatch/i);
  });

  it("returns ok: false when the timestamp is stale (> 5 minutes)", () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
    const header = buildValidStripeHeader(rawBody, secret, staleTimestamp);
    const result = verifyStripeSignature(header, rawBody, secret);
    expectFailureWithReason(result, /timestamp/i);
  });

  it("returns ok: false for a non-numeric timestamp", () => {
    const header = "t=not-a-number,v1=abc123";
    const result = verifyStripeSignature(header, rawBody, secret);
    expect(result.ok).toBe(false);
  });

  it("accepts a signature from multiple v1 entries when any match", () => {
    const ts = Math.floor(Date.now() / 1000);
    const signedPayload = `${ts}.${rawBody}`;
    const validSig = createHmac("sha256", secret)
      .update(signedPayload, "utf8")
      .digest("hex");
    const header = `t=${ts},v1=invalidsig,v1=${validSig}`;
    const result = verifyStripeSignature(header, rawBody, secret);
    expect(result).toEqual({ ok: true });
  });
});

describe("verifyProviderSignature", () => {
  const secret = "whsec_test_secret";
  const rawBody = JSON.stringify({ type: "charge.succeeded" });

  it("returns ok: true for null provider (slug-only, no signature required)", () => {
    const result = verifyProviderSignature({
      provider: null,
      headers: {},
      rawBody,
      secret: null,
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: true for empty-string provider", () => {
    const result = verifyProviderSignature({
      provider: "",
      headers: {},
      rawBody,
      secret: null,
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false for unrecognized non-null provider (fail closed)", () => {
    const result = verifyProviderSignature({
      provider: "mailchimp",
      headers: {},
      rawBody,
      secret: null,
    });
    expectFailureWithReason(result, /Unsupported provider/i);
  });

  it("returns ok: false for provider with different casing than supported", () => {
    const result = verifyProviderSignature({
      provider: "Stripe",
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody,
      secret,
    });
    // "Stripe" normalizes to "stripe" — should reach Stripe verification (not unsupported),
    // then fail on the malformed signature rather than an unsupported-provider error.
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).not.toMatch(
      /Unsupported/i,
    );
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /timestamp|mismatch|signature/i,
    );
  });

  it("returns ok: false for stripe provider when secret is missing", () => {
    const result = verifyProviderSignature({
      provider: "stripe",
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody,
      secret: null,
    });
    expectFailureWithReason(result, /secret/i);
  });

  it("returns ok: false for stripe provider when Stripe-Signature header is missing", () => {
    const result = verifyProviderSignature({
      provider: "stripe",
      headers: {},
      rawBody,
      secret,
    });
    expectFailureWithReason(result, /Missing Stripe-Signature/i);
  });

  it("returns ok: true for stripe provider with a valid signature", () => {
    const header = buildValidStripeHeader(rawBody, secret);

    const result = verifyProviderSignature({
      provider: "stripe",
      headers: { "stripe-signature": header },
      rawBody,
      secret,
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false for stripe provider with an invalid signature", () => {
    const result = verifyProviderSignature({
      provider: "stripe",
      headers: {
        "stripe-signature": buildValidStripeHeader(rawBody, "wrong_secret"),
      },
      rawBody,
      secret,
    });
    expect(result.ok).toBe(false);
  });

  describe("github provider", () => {
    it("returns ok: false when the secret is not configured", () => {
      const result = verifyProviderSignature({
        provider: "github",
        headers: { "x-hub-signature-256": "sha256=abc" },
        rawBody,
        secret: null,
      });
      expectFailureWithReason(result, /secret/i);
    });

    it("returns ok: false when the X-Hub-Signature-256 header is missing", () => {
      const result = verifyProviderSignature({
        provider: "github",
        headers: {},
        rawBody,
        secret,
      });
      expectFailureWithReason(result, /Missing X-Hub-Signature-256/i);
    });

    it("returns ok: true for a valid signature", () => {
      const header = buildValidGithubHeader(rawBody, secret);
      const result = verifyProviderSignature({
        provider: "github",
        headers: { "x-hub-signature-256": header },
        rawBody,
        secret,
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok: false for a mismatched signature", () => {
      const header = buildValidGithubHeader(rawBody, "wrong_secret");
      const result = verifyProviderSignature({
        provider: "github",
        headers: { "x-hub-signature-256": header },
        rawBody,
        secret,
      });
      expectFailureWithReason(result, /mismatch/i);
    });
  });

  describe("zapier and shortcuts providers (shared secret)", () => {
    it.each(["zapier", "shortcuts"])(
      "returns ok: false for %s when the secret is not configured",
      (provider) => {
        const result = verifyProviderSignature({
          provider,
          headers: { [SHARED_SECRET_HEADER]: "anything" },
          rawBody,
          secret: null,
        });
        expectFailureWithReason(result, /secret/i);
      },
    );

    it.each(["zapier", "shortcuts"])(
      "returns ok: false for %s when the shared secret header is missing",
      (provider) => {
        const result = verifyProviderSignature({
          provider,
          headers: {},
          rawBody,
          secret,
        });
        expectFailureWithReason(
          result,
          new RegExp(`Missing ${SHARED_SECRET_HEADER}`, "i"),
        );
      },
    );

    it.each(["zapier", "shortcuts"])(
      "returns ok: true for %s when the provided secret hashes to the stored hash",
      (provider) => {
        const result = verifyProviderSignature({
          provider,
          headers: { [SHARED_SECRET_HEADER]: secret },
          rawBody,
          secret: hashSharedSecret(secret),
        });
        expect(result).toEqual({ ok: true });
      },
    );

    it.each(["zapier", "shortcuts"])(
      "returns ok: false for %s when the shared secret does not match",
      (provider) => {
        const result = verifyProviderSignature({
          provider,
          headers: { [SHARED_SECRET_HEADER]: "wrong" },
          rawBody,
          secret: hashSharedSecret(secret),
        });
        expectFailureWithReason(result, /mismatch/i);
      },
    );
  });
});

describe("verifyGithubSignature", () => {
  const secret = "github_test_secret";
  const rawBody = JSON.stringify({ ref: "refs/heads/main" });

  it("returns ok: true for a valid signature", () => {
    const header = buildValidGithubHeader(rawBody, secret);
    expect(verifyGithubSignature(header, rawBody, secret)).toEqual({
      ok: true,
    });
  });

  it("returns ok: false for a header missing the sha256= prefix", () => {
    const result = verifyGithubSignature("abc123", rawBody, secret);
    expectFailureWithReason(result, /Invalid X-Hub-Signature-256/i);
  });

  it("returns ok: false when the signature does not match", () => {
    const header = buildValidGithubHeader(rawBody, "wrong_secret");
    const result = verifyGithubSignature(header, rawBody, secret);
    expectFailureWithReason(result, /mismatch/i);
  });
});

describe("verifySharedSecret", () => {
  // The second argument is the STORED value, which is a SHA-256 hash of the
  // secret (see hashSharedSecret) — not the plaintext.
  const secret = "shared_test_secret";
  const storedHash = hashSharedSecret(secret);

  it("returns ok: true when the provided secret hashes to the stored hash", () => {
    expect(verifySharedSecret(secret, storedHash)).toEqual({ ok: true });
  });

  it("returns ok: false when the provided secret is undefined", () => {
    const result = verifySharedSecret(undefined, storedHash);
    expectFailureWithReason(
      result,
      new RegExp(`Missing ${SHARED_SECRET_HEADER}`, "i"),
    );
  });

  it("returns ok: false when the provided secret does not match", () => {
    const result = verifySharedSecret("nope", storedHash);
    expectFailureWithReason(result, /mismatch/i);
  });

  it("returns ok: false when the stored hash is malformed (no timingSafeEqual crash)", () => {
    const result = verifySharedSecret(secret, "not-a-valid-hash");
    expectFailureWithReason(result, /mismatch/i);
  });
});

describe("hashSharedSecret", () => {
  it("returns a 64-char hex SHA-256 digest", () => {
    expect(hashSharedSecret("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashSharedSecret("same-value")).toBe(hashSharedSecret("same-value"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashSharedSecret("value-a")).not.toBe(hashSharedSecret("value-b"));
  });
});

describe("generateProviderSecret", () => {
  it("returns a 48-char hex string (24 random bytes)", () => {
    const secret = generateProviderSecret();
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("returns a different value on each call", () => {
    expect(generateProviderSecret()).not.toBe(generateProviderSecret());
  });
});

describe("isSecretBackedProvider", () => {
  it.each(SECRET_BACKED_PROVIDERS)("returns true for %s", (provider) => {
    expect(isSecretBackedProvider(provider)).toBe(true);
  });

  it.each(["stripe", "webhook", "email", "rss", ""])(
    "returns false for %s",
    (provider) => {
      expect(isSecretBackedProvider(provider)).toBe(false);
    },
  );
});

describe("isManualSecretProvider", () => {
  it.each(MANUAL_SECRET_PROVIDERS)("returns true for %s", (provider) => {
    expect(isManualSecretProvider(provider)).toBe(true);
  });

  it.each(["github", "zapier", "shortcuts", "webhook", "email", ""])(
    "returns false for %s",
    (provider) => {
      expect(isManualSecretProvider(provider)).toBe(false);
    },
  );
});

describe("isHashedStorageProvider", () => {
  it.each(["zapier", "shortcuts"])("returns true for %s", (provider) => {
    expect(isHashedStorageProvider(provider)).toBe(true);
  });

  it.each(["github", "stripe", "webhook", "email", ""])(
    "returns false for %s (verified via HMAC, needs the raw secret)",
    (provider) => {
      expect(isHashedStorageProvider(provider)).toBe(false);
    },
  );
});

describe("buildStripeSignatureHeader / buildGithubSignatureHeader", () => {
  // Pinned against the independent fixtures in tests/server/helpers.ts (a
  // hand-transcribed re-implementation of each provider's published signing
  // scheme, deliberately NOT sharing code with signatureVerifier.ts — see that
  // file's comment). These builders share their HMAC computation with
  // verifyStripeSignature/verifyGithubSignature above, so nothing in this
  // suite can catch signing and verifying drifting onto the same wrong
  // algorithm together; this cross-check against an independent oracle is
  // what closes that gap. If either provider's signing scheme is broken here
  // (wrong delimiter, wrong hash algorithm), this is the assertion that fails.
  it("produces the same Stripe-Signature header as an independent HMAC transcription", () => {
    const body = JSON.stringify({ id: "evt_test" });
    const secret = "whsec_pin_test";
    const timestamp = 1_700_000_000;

    expect(buildStripeSignatureHeader(body, secret, timestamp)).toBe(
      buildValidStripeHeader(body, secret, timestamp),
    );
  });

  it("produces the same X-Hub-Signature-256 header as an independent HMAC transcription", () => {
    const body = JSON.stringify({ zen: "test" });
    const secret = "gh_pin_test";

    expect(buildGithubSignatureHeader(body, secret)).toBe(
      buildValidGithubHeader(body, secret),
    );
  });

  it("round-trips through the real verify functions (not just against the fixture)", () => {
    const body = JSON.stringify({ ok: true });
    const secret = "shared-pin-secret";
    // No fixed timestamp here (unlike the pinned header-format tests above):
    // verifyStripeSignature also enforces a freshness window against the
    // current clock, so this must sign with "now" for the round trip to pass.

    expect(
      verifyStripeSignature(
        buildStripeSignatureHeader(body, secret),
        body,
        secret,
      ),
    ).toEqual({ ok: true });
    expect(
      verifyGithubSignature(
        buildGithubSignatureHeader(body, secret),
        body,
        secret,
      ),
    ).toEqual({ ok: true });
  });
});
