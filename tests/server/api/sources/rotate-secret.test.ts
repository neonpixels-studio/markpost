import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { hashSharedSecret } from "../../../../server/utils/signatureVerifier";

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock, update: updateMock }),
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
  await import("../../../../server/api/sources/[uuid]/rotate-secret.post");

const userId = "user_abc123";
const validUuid = "550e8400-e29b-41d4-a716-446655440001";

const sampleSource = {
  uuid: validUuid,
  userId,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  type: "webhook",
  name: "My Source",
  provider: null as string | null,
  providerSecret: null as string | null,
  endpointSlug: "wh_8f2a91c4",
  routeFolder: "99-incoming/",
  fieldMapping: null,
  lastHitAt: null,
  recordCount: 0,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(attributes: Record<string, unknown> = {}) {
  return { data: { type: "sources", attributes } };
}

function stubSelectResult(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

function stubUpdateResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where, returning };
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
// values (userId, the previous secret, the `is null` chunk) we assert on.
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
  mockGetRouterParam.mockReset();
  selectMock.mockReset();
  updateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/sources/:uuid/rotate-secret", () => {
  it("regenerates and reveals a new plaintext secret for a github source, preserving the endpointSlug", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    const { where: selectWhere } = stubSelectResult([
      { ...sampleSource, provider: "github", providerSecret: "old-secret" },
    ]);
    const { set, where } = stubUpdateResult([
      { ...sampleSource, provider: "github", providerSecret: "old-secret" },
    ]);

    const response = await handler(buildEvent(userId));

    const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
    // GitHub verifies via HMAC, so the raw secret is stored (48 hex chars) and
    // the stored value MUST equal the revealed one — a mismatch here 401s every
    // GitHub delivery forever, the exact failure this endpoint prevents.
    expect(storedArg.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(storedArg.providerSecret).not.toBe("old-secret");
    expect(storedArg.providerSecret).toBe(
      attributesOf(response).providerSecret,
    );
    // The read is scoped to this user (no cross-tenant probing by uuid).
    const selectSql = serializeSql(selectWhere.mock.calls[0]?.[0]);
    expect(selectSql).toContain(userId);
    expect(selectSql).toContain(validUuid);
    // The UPDATE is scoped to this user AND gated on the previously-read secret
    // (optimistic concurrency) — assert both terms actually reached the query.
    const whereSql = serializeSql(where.mock.calls[0]?.[0]);
    expect(whereSql).toContain(userId);
    expect(whereSql).toContain("old-secret");
    // The update payload only touches providerSecret — endpointSlug is never
    // part of the write, so the provider's webhook URL keeps working.
    expect(storedArg).not.toHaveProperty("endpointSlug");
    expect(attributesOf(response).providerSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(attributesOf(response).endpointSlug).toBe("wh_8f2a91c4");
  });

  it("gates the write with `is null` when the prior secret was unset (recovering a never-set secret)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([
      { ...sampleSource, provider: "github", providerSecret: null },
    ]);
    const { set, where } = stubUpdateResult([
      { ...sampleSource, provider: "github", providerSecret: null },
    ]);

    const response = await handler(buildEvent(userId));

    const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
    expect(storedArg.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    // A null prior secret must gate on `is null`, not `= NULL` (which matches
    // nothing and would 409 every rotation of a never-set secret forever).
    const whereSql = serializeSql(where.mock.calls[0]?.[0]).toLowerCase();
    expect(whereSql).toContain("is null");
    expect(attributesOf(response).providerSecret).toBe(
      storedArg.providerSecret,
    );
  });

  it.each([undefined, {} as Record<string, unknown>])(
    "rotates a github source when the request carries no usable body (%p)",
    async (body) => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(body);
      stubSelectResult([{ ...sampleSource, provider: "github" }]);
      const { set } = stubUpdateResult([
        { ...sampleSource, provider: "github" },
      ]);

      const response = await handler(buildEvent(userId));

      const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
      expect(storedArg.providerSecret).toMatch(/^[0-9a-f]{48}$/);
      expect(attributesOf(response).providerSecret).toBe(
        storedArg.providerSecret,
      );
    },
  );

  it.each(["zapier", "shortcuts"])(
    "stores only a hash but reveals the plaintext once for %s",
    async (provider) => {
      mockGetRouterParam.mockReturnValue(validUuid);
      mockReadBody.mockResolvedValue(buildBody());
      stubSelectResult([{ ...sampleSource, provider }]);
      const { set } = stubUpdateResult([{ ...sampleSource, provider }]);

      const response = await handler(buildEvent(userId));

      const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
      const revealed = attributesOf(response).providerSecret as string;
      expect(storedArg.providerSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(revealed).toMatch(/^[0-9a-f]{48}$/);
      // The stored hash must be the hash OF the revealed plaintext, not some
      // other value — otherwise verification never matches the shared secret.
      expect(storedArg.providerSecret).toBe(hashSharedSecret(revealed));
    },
  );

  it("stores the caller-supplied secret verbatim for stripe and never echoes it back", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ providerSecret: "whsec_rotated_value" }),
    );
    stubSelectResult([{ ...sampleSource, provider: "stripe" }]);
    const { set } = stubUpdateResult([{ ...sampleSource, provider: "stripe" }]);

    const response = await handler(buildEvent(userId));

    const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
    expect(storedArg.providerSecret).toBe("whsec_rotated_value");
    expect(attributesOf(response).providerSecret).toBeNull();
  });

  it("throws 422 when rotating a stripe source without supplying the new secret", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([{ ...sampleSource, provider: "stripe" }]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("providerSecret is required"),
          }),
        ],
      },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("throws 422 when a generated-secret provider is sent a providerSecret", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ providerSecret: "attacker-supplied" }),
    );
    stubSelectResult([{ ...sampleSource, provider: "github" }]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("only accepted"),
          }),
        ],
      },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("throws 422 when the source has no provider (nothing to rotate)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([{ ...sampleSource, provider: null }]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("no provider set"),
          }),
        ],
      },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("throws 422 for a stored provider this backend cannot verify (legacy/hand-edited row)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([{ ...sampleSource, provider: "gitlab" }]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("Provider must be one of"),
          }),
        ],
      },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("treats providerSecret: null as absent — generates a fresh secret for github", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ providerSecret: null }));
    stubSelectResult([{ ...sampleSource, provider: "github" }]);
    const { set } = stubUpdateResult([{ ...sampleSource, provider: "github" }]);

    const response = await handler(buildEvent(userId));

    const storedArg = (set.mock.calls[0] as [Record<string, unknown>])[0];
    expect(storedArg.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(attributesOf(response).providerSecret).toBe(
      storedArg.providerSecret,
    );
  });

  it("treats providerSecret: null as absent for stripe — reports the required error, not a type error", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ providerSecret: null }));
    stubSelectResult([{ ...sampleSource, provider: "stripe" }]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("providerSecret is required"),
          }),
        ],
      },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("throws 422 when providerSecret is not a string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ providerSecret: 12345 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          {
            status: "422",
            title: "Invalid Attribute",
            detail: "ProviderSecret must be a string",
            source: { pointer: "/data/attributes/providerSecret" },
          },
        ],
      },
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("throws 404 when the source does not exist for the user", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([]);
    const { set } = stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("throws 409 when the secret changed between the read and the write (concurrent rotation)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    stubSelectResult([{ ...sampleSource, provider: "github" }]);
    // The optimistic-concurrency UPDATE matched zero rows: another rotation
    // committed first, so this request's generated secret was never stored and
    // must not be revealed as if it were.
    stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 409,
      data: {
        errors: [
          expect.objectContaining({
            detail: expect.stringContaining("changed during this request"),
          }),
        ],
      },
    });
  });

  it("throws 404 when the source is deleted between the read and the write", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody());
    // First read finds the source; the re-read after a zero-row UPDATE finds
    // nothing, so this is a genuine 404, not a concurrency 409.
    const buildSelectChain = (rows: unknown[]) => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: () => rows })) })),
    });
    selectMock
      .mockReturnValueOnce(
        buildSelectChain([{ ...sampleSource, provider: "github" }]),
      )
      .mockReturnValueOnce(buildSelectChain([]));
    stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 400 when the uuid is malformed", async () => {
    mockGetRouterParam.mockReturnValue("not-a-uuid");
    mockReadBody.mockResolvedValue(buildBody());

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);

    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({ status: "401", title: "Unauthorized" }),
        ],
      },
    });
  });
});
