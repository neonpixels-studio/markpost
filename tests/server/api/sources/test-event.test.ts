import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { hashSharedSecret } from "../../../../server/utils/signatureVerifier";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();
const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/sources/[uuid]/test.post");

const userId = "user_abc123";
const validUuid = "550e8400-e29b-41d4-a716-446655440001";

const sampleSource = {
  uuid: validUuid,
  userId,
  type: "webhook",
  name: "My Source",
  provider: null as string | null,
  providerSecret: null as string | null,
  fieldMapping: null as unknown,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(attributes: Record<string, unknown> = {}) {
  return { data: { type: "sourceTestEvents", attributes } };
}

// Two-step chain (select -> from -> where -> limit) returning the given rows,
// mirroring the source lookup used by every other sources/:uuid handler.
// The handler issues up to two selects: the source lookup, then (only if it
// gets as far as buildFieldMappingPreview) the userSettings lookup for
// filenameTemplate (server/utils/userSettings.ts). Queuing them with
// mockReturnValueOnce — rather than one shared mockReturnValue every select
// call resolves to — keeps the two independent, so a test asserting on the
// source query's `where` args can't accidentally read the settings query's,
// and a test can stub a specific filenameTemplate without it leaking into the
// source row. Omitting filenameTemplate (the default for every test that
// doesn't care) yields an empty settings result, which fetchFilenameTemplate
// falls back from — the same effective behavior every test here relied on
// before this was split out.
function stubSource(
  row: Partial<typeof sampleSource> | null,
  filenameTemplate?: string,
) {
  const rows = row ? [{ ...sampleSource, ...row }] : [];
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));

  const settingsRows =
    filenameTemplate === undefined ? [] : [{ filenameTemplate }];
  const settingsLimit = vi.fn(() => Promise.resolve(settingsRows));
  const settingsWhere = vi.fn(() => ({ limit: settingsLimit }));
  const settingsFrom = vi.fn(() => ({ where: settingsWhere }));

  selectMock
    .mockReturnValueOnce({ from })
    .mockReturnValueOnce({ from: settingsFrom });

  return { from, where, limit };
}

function attributesOf(response: unknown) {
  return (
    response as {
      data: { attributes: Record<string, unknown> };
    }
  ).data.attributes;
}

// Drizzle column objects hold circular table<->column refs, so a plain
// JSON.stringify throws. Drop repeated objects but keep the primitive param
// values (e.g. userId) we assert on. Mirrors the same helper in
// rotate-secret.test.ts.
function serializeSql(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val !== "object" || val === null) {
      return val;
    }

    if (seen.has(val)) {
      return undefined;
    }

    seen.add(val);
    return val;
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockReadBody.mockReset();
  mockReadBody.mockResolvedValue(undefined);
  mockGetRouterParam.mockReset();
  mockGetRouterParam.mockReturnValue(validUuid);
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/sources/:uuid/test", () => {
  it("reports not_required for a plain webhook source with no provider, and previews raw field mapping", async () => {
    stubSource({ provider: null, providerSecret: null });

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.signatureCheck).toMatchObject({ status: "not_required" });
    expect(attributes.fieldMapping).toMatchObject({
      title: "Test event from markpost",
      tags: ["test"],
    });
  });

  it("shapes the previewed filePath with the user's configured filenameTemplate", async () => {
    stubSource({ provider: null, providerSecret: null }, "{{slug}}.md");

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    // Default sample payload's title ("Test event from markpost") slugifies to
    // this — proves fetchFilenameTemplate's result actually reaches
    // parseWebhookPayload rather than always falling back to the
    // {{date}}-{{slug}}.md default (which this template omits the date from).
    expect(attributes.fieldMapping).toMatchObject({
      filePath: "test-event-from-markpost.md",
    });
  });

  it("verifies a github source by signing the test payload with its own stored secret", async () => {
    stubSource({ provider: "github", providerSecret: "gh-secret-value" });

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.signatureCheck.status).toBe("verified");
    // The stored secret must never leak into the response body — only the
    // fact that it produced a valid signature is reportable.
    expect(JSON.stringify(response)).not.toContain("gh-secret-value");
  });

  it("reports failed for a github source with no configured secret", async () => {
    stubSource({ provider: "github", providerSecret: null });

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.signatureCheck).toMatchObject({
      status: "failed",
      message: expect.stringContaining("not configured"),
    });
  });

  it("verifies a stripe source by signing the test payload with its own stored secret", async () => {
    stubSource({ provider: "stripe", providerSecret: "whsec_test_value" });

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.signatureCheck.status).toBe("verified");
    expect(JSON.stringify(response)).not.toContain("whsec_test_value");
  });

  it.each(["zapier", "shortcuts"])(
    "reports not_verifiable for %s (hash-only secret storage, cannot be re-signed)",
    async (provider) => {
      stubSource({
        provider,
        providerSecret: hashSharedSecret("some-plaintext-secret"),
      });

      const response = await handler(buildEvent(userId));

      const attributes = attributesOf(response);
      expect(attributes.signatureCheck).toMatchObject({
        status: "not_verifiable",
      });
      // Field mapping must still run even though the signature can't be
      // checked — the two checks are independent.
      expect(attributes.fieldMapping).toMatchObject({
        title: "Test event from markpost",
      });
    },
  );

  it("reports failed for an unsupported/legacy provider string", async () => {
    stubSource({ provider: "gitlab", providerSecret: "whatever" });

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.signatureCheck).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Unsupported provider"),
    });
  });

  it("applies the source's field mapping to a caller-supplied custom payload", async () => {
    stubSource({
      provider: null,
      fieldMapping: { title: "data.subject", content: "data.body" },
    });
    mockReadBody.mockResolvedValue(
      buildBody({ payload: { data: { subject: "Hi", body: "Body text" } } }),
    );

    const response = await handler(buildEvent(userId));

    const attributes = attributesOf(response);
    expect(attributes.fieldMapping).toMatchObject({
      title: "Hi",
      content: "Body text",
    });
    expect(attributes.payload).toEqual({
      data: { subject: "Hi", body: "Body text" },
    });
  });

  it("throws 422 when the supplied payload is not a JSON object", async () => {
    stubSource({ provider: null });
    mockReadBody.mockResolvedValue(buildBody({ payload: "not-an-object" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("payload must be a JSON object"),
          }),
        ],
      },
    });
  });

  it("throws 413 for a payload exceeding the same size cap real webhook deliveries are held to", async () => {
    stubSource({ provider: null });
    // MAX_WEBHOOK_BODY_BYTES is 1 MiB (webhookBodyLimit.ts); a single oversized
    // field comfortably clears it once JSON-stringified.
    mockReadBody.mockResolvedValue(
      buildBody({ payload: { content: "x".repeat(1_100_000) } }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it("throws 422 for an email source (never ingests via the JSON webhook path)", async () => {
    stubSource({ type: "email", provider: null });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining(
              "does not ingest via the JSON webhook path",
            ),
          }),
        ],
      },
    });
  });

  it("throws 404 when the source does not exist for the user", async () => {
    stubSource(null);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 400 when the uuid is malformed", async () => {
    mockGetRouterParam.mockReturnValue("not-a-uuid");

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("scopes the source lookup to the requesting user (no cross-tenant probing by uuid)", async () => {
    const { where } = stubSource({ provider: null });

    await handler(buildEvent(userId));

    const whereArg = where.mock.calls[0]?.[0];
    expect(serializeSql(whereArg)).toContain(userId);
  });
});
