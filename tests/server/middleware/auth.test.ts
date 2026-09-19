import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { generateRawToken, hashToken } from "../../../server/utils/tokens";
import { stubFailingUpdate, spyConsoleError } from "../helpers";

// Hand-written (not derived from unauthorizedError()) so the assertion fails if
// the production envelope shape or copy ever drifts.
const expectedUnauthorizedEnvelope = {
  statusCode: 401,
  data: {
    errors: [
      {
        status: "401",
        title: "Unauthorized",
        detail: "Authentication is required to access this resource.",
      },
    ],
  },
};

// Hand-written (not derived from tooManyRequestsError()) for the same reason.
const expectedTooManyRequestsEnvelope = {
  statusCode: 429,
  data: {
    errors: [
      {
        status: "429",
        title: "Too Many Requests",
        detail:
          "You have made too many requests. Slow down and try again shortly.",
      },
    ],
  },
};

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock, update: updateMock }),
}));

const mockVerifyToken = vi.fn();

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ verifyToken: mockVerifyToken }),
}));

const mockEnsureUserRegistered = vi.fn();

vi.mock("../../../server/utils/auth", () => ({
  ensureUserRegistered: mockEnsureUserRegistered,
}));

const mockRecordAuthedApiHit = vi.fn();

vi.mock("../../../server/utils/apiThrottle", () => ({
  recordAuthedApiHit: mockRecordAuthedApiHit,
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetHeader = vi.fn();
const mockSetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } = await import("../../../server/middleware/auth");

const userId = "user_abc123";
const tokenId = "token-uuid-1";

function buildEvent(path: string = "/api/records"): H3Event & {
  context: {
    userId?: string;
    tokenScopes?: string[] | null;
    tokenExpiresAt?: Date | null;
  };
} {
  return { path, context: {} } as unknown as H3Event & {
    context: {
      userId?: string;
      tokenScopes?: string[] | null;
      tokenExpiresAt?: Date | null;
    };
  };
}

function stubSelectResult(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

function stubUpdateSuccess() {
  const where = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("setHeader", mockSetHeader);
  mockCreateError.mockClear();
  mockGetHeader.mockClear();
  mockSetHeader.mockClear();
  selectMock.mockReset();
  updateMock.mockReset();
  mockVerifyToken.mockReset();
  mockEnsureUserRegistered.mockReset();
  mockRecordAuthedApiHit.mockReset();
  // Every existing test in this file predates the throttle and asserts on
  // authentication behavior only; default to "allowed" so none of them have
  // to know about it, and let the "authenticated API throttle" describe block
  // below override this per-test.
  mockRecordAuthedApiHit.mockResolvedValue({ allowed: true });
  process.env.NUXT_CLERK_SECRET_KEY = "test_secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NUXT_CLERK_SECRET_KEY;
});

describe("auth middleware", () => {
  describe("non-API paths", () => {
    it("skips authentication for non-API paths", async () => {
      const event = buildEvent("/some-other-path");
      await handler(event);
      expect(event.context.userId).toBeUndefined();
    });
  });

  describe("public webhook paths", () => {
    const publicPaths = [
      "/api/hooks/some-slug",
      "/api/billing/webhook",
      "/api/webhooks/clerk",
    ];

    it.each(publicPaths)(
      "bypasses token/session auth for %s (verified by its own signature)",
      async (path) => {
        const event = buildEvent(path);

        await expect(handler(event)).resolves.toBeUndefined();

        expect(event.context.userId).toBeUndefined();
        expect(mockGetHeader).not.toHaveBeenCalled();
        expect(mockVerifyToken).not.toHaveBeenCalled();
        expect(selectMock).not.toHaveBeenCalled();
        expect(mockRecordAuthedApiHit).not.toHaveBeenCalled();
      },
    );
  });

  describe("missing token", () => {
    it("throws 401 when the Authorization header is absent", async () => {
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not spend throttle budget when authentication fails", async () => {
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockRecordAuthedApiHit).not.toHaveBeenCalled();
    });
  });

  describe("mp_live_ API token authentication", () => {
    it("authenticates a valid mp_live_ token and sets userId", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("authenticates when the Authorization header uses lowercase bearer", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("updates lastUsedAt when a valid token authenticates", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(updateMock).toHaveBeenCalled();
    });

    it("skips the lastUsedAt write when the stored value is still fresh", async () => {
      const rawToken = generateRawToken();
      const justNow = new Date();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, lastUsedAt: justNow }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("writes lastUsedAt when the stored value is stale", async () => {
      const rawToken = generateRawToken();
      const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, lastUsedAt: longAgo }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(updateMock).toHaveBeenCalled();
    });

    it("still sets userId when the lastUsedAt update fails", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);

      stubFailingUpdate(updateMock);
      const consoleErrorSpy = spyConsoleError();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("throws 401 for an unknown mp_live_ token (not in db)", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("throws 401 for a revoked mp_live_ token", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("authenticates a token with a NULL expiresAt (legacy, no expiry)", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("authenticates a token with a future expiresAt", async () => {
      const rawToken = generateRawToken();
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt: future }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("throws 401 for a token with a past expiresAt", async () => {
      const rawToken = generateRawToken();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt: past }]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not update lastUsedAt for an expired token", async () => {
      const rawToken = generateRawToken();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt: past }]);

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(updateMock).not.toHaveBeenCalled();
    });

    it("does not call Clerk for mp_live_ tokens", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it("queries the database with an exact hash lookup, not a full table scan", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      const stubs = stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(stubs.where).toHaveBeenCalledOnce();
      expect(stubs.limit).toHaveBeenCalledWith(1);
    });
  });

  describe("tokenScopes context (server/utils/auth.ts requireScope reads this)", () => {
    it("sets tokenScopes to null for a legacy/unscoped token (full access)", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, scopes: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenScopes).toBeNull();
    });

    it("carries the token's scopes array through to context", async () => {
      const rawToken = generateRawToken();
      const scopes = ["records:read", "records:write"];

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, scopes }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenScopes).toEqual(scopes);
    });

    it("sets tokenScopes to null for a Clerk session (always full access)", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenScopes).toBeNull();
    });
  });

  describe("tokenExpiresAt context (mint-time caller-authority clamp reads this)", () => {
    it("carries the token's own expiresAt through to context", async () => {
      const rawToken = generateRawToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toEqual(expiresAt);
    });

    it("sets tokenExpiresAt to null for a token that never expires", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId, expiresAt: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toBeNull();
    });

    it("sets tokenExpiresAt to null for a Clerk session (no token to inherit a lifetime from)", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toBeNull();
    });
  });

  describe("Clerk JWT authentication", () => {
    it("authenticates a valid Clerk JWT and sets userId", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("throws 401 for an invalid Clerk JWT", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockRejectedValue(new Error("Invalid token"));

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not query the database for Clerk JWTs", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("sign-up registration", () => {
    it("registers the user on the Clerk path", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(mockEnsureUserRegistered).toHaveBeenCalledWith(userId);
    });

    it("does not run registration for API token authentication", async () => {
      const rawToken = generateRawToken();
      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockEnsureUserRegistered).not.toHaveBeenCalled();
    });

    it("propagates a rejection from registration and leaves userId unset", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });
      mockEnsureUserRegistered.mockRejectedValue(
        Object.assign(new Error("disabled"), { statusCode: 403 }),
      );

      const event = buildEvent();
      await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 });
      expect(event.context.userId).toBeUndefined();
      expect(mockRecordAuthedApiHit).not.toHaveBeenCalled();
    });
  });

  describe("authenticated API throttle", () => {
    it("spends throttle budget against the resolved userId for a Clerk session", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      mockGetHeader.mockReturnValue(`Bearer ${clerkToken}`);
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(mockRecordAuthedApiHit).toHaveBeenCalledWith(userId);
    });

    it("spends throttle budget against the resolved userId for an API token", async () => {
      const rawToken = generateRawToken();
      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockRecordAuthedApiHit).toHaveBeenCalledWith(userId);
    });

    it("throws 429 with a Retry-After header once the user is over the limit", async () => {
      const rawToken = generateRawToken();
      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();
      mockRecordAuthedApiHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 17,
      });

      const event = buildEvent();
      await expect(handler(event)).rejects.toThrow();

      expect(mockCreateError).toHaveBeenCalledWith(
        expectedTooManyRequestsEnvelope,
      );
      expect(mockSetHeader).toHaveBeenCalledWith(event, "Retry-After", "17");
    });

    it("does not set userId when the request is throttled", async () => {
      const rawToken = generateRawToken();
      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();
      mockRecordAuthedApiHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 5,
      });

      const event = buildEvent();
      await expect(handler(event)).rejects.toThrow();

      expect(event.context.userId).toBeUndefined();
    });
  });
});
