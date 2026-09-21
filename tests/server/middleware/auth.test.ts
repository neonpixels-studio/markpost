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

// Distinct detail copy from expectedTooManyRequestsEnvelope above: that one
// is enforceApiThrottle's (already-authenticated, userId-keyed) message, this
// is the failed-auth IP throttle's (pre-verification, IP-keyed) message.
const expectedAuthFailureThrottleEnvelope = {
  statusCode: 429,
  data: {
    errors: [
      {
        status: "429",
        title: "Too Many Requests",
        detail:
          "Too many failed authentication attempts from this IP address. Slow down and try again shortly.",
      },
    ],
  },
};

// Duplicated from the private constant of the same name in
// server/middleware/auth.ts rather than importing it: this is Netlify's own
// header name (https://docs.netlify.com/functions/api/), a stable external
// contract, not an implementation detail — a test importing production
// constants to build its own expectations would stop catching a typo in
// either place.
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const DEFAULT_CLIENT_IP = "203.0.113.10";

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

const mockReserveAuthAttempt = vi.fn();
const mockRefundAuthAttempt = vi.fn();

vi.mock("../../../server/utils/authFailureThrottle", () => ({
  reserveAuthAttempt: mockReserveAuthAttempt,
  refundAuthAttempt: mockRefundAuthAttempt,
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetHeader = vi.fn();
const mockSetHeader = vi.fn();
const mockGetRequestIP = vi.fn();

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

// Routes getHeader by header name, mirroring how the middleware reads two
// distinct headers (Authorization for the credential, the Netlify client-IP
// header for the throttle key) rather than letting a single mockReturnValue
// answer both indiscriminately. clientIp defaults to a resolvable address so
// existing auth-behavior tests don't have to know the throttle exists; pass
// clientIp: undefined explicitly to simulate an unresolvable Netlify header.
// Checked with `"clientIp" in options` rather than a `= DEFAULT_CLIENT_IP`
// default parameter: a default parameter substitutes on `undefined`
// regardless of whether the caller omitted the key or passed it explicitly,
// which would silently turn "explicitly unresolved" back into the default.
function stubHeaders(options: {
  authorization?: string;
  clientIp?: string | undefined;
}) {
  const clientIp = "clientIp" in options ? options.clientIp : DEFAULT_CLIENT_IP;
  mockGetHeader.mockImplementation((_event: unknown, name: string) => {
    if (name === "authorization") {
      return options.authorization;
    }
    if (name === NETLIFY_CLIENT_IP_HEADER) {
      return clientIp;
    }
    return undefined;
  });
}

function stubSelectResult(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

function stubSelectFailure(error: Error) {
  const limit = vi.fn(() => Promise.reject(error));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
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
  vi.stubGlobal("getRequestIP", mockGetRequestIP);
  mockCreateError.mockClear();
  mockGetHeader.mockReset();
  mockSetHeader.mockClear();
  mockGetRequestIP.mockReset();
  selectMock.mockReset();
  updateMock.mockReset();
  mockVerifyToken.mockReset();
  mockEnsureUserRegistered.mockReset();
  mockRecordAuthedApiHit.mockReset();
  mockReserveAuthAttempt.mockReset();
  mockRefundAuthAttempt.mockReset();
  // Every existing test in this file predates the throttles and asserts on
  // authentication behavior only; default all to "allowed"/no-op so none of
  // them have to know about either throttle, and let the dedicated throttle
  // describe blocks below override per-test.
  mockRecordAuthedApiHit.mockResolvedValue({ allowed: true });
  mockReserveAuthAttempt.mockResolvedValue({ allowed: true });
  mockRefundAuthAttempt.mockResolvedValue(undefined);
  mockGetRequestIP.mockReturnValue(undefined);
  stubHeaders({});
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
      stubHeaders({ authorization: undefined });

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not spend authenticated-API throttle budget when authentication fails", async () => {
      stubHeaders({ authorization: undefined });

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockRecordAuthedApiHit).not.toHaveBeenCalled();
    });

    it("does not touch the failed-auth IP throttle for a missing header (not a guess)", async () => {
      stubHeaders({ authorization: undefined });

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockReserveAuthAttempt).not.toHaveBeenCalled();
      expect(mockRefundAuthAttempt).not.toHaveBeenCalled();
    });

    it("throws 401 without touching the throttle for a bare 'Bearer ' header (empty token)", async () => {
      stubHeaders({ authorization: "Bearer " });

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
      expect(mockReserveAuthAttempt).not.toHaveBeenCalled();
    });
  });

  describe("mp_live_ API token authentication", () => {
    it("authenticates a valid mp_live_ token and sets userId", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("authenticates when the Authorization header uses lowercase bearer", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("updates lastUsedAt when a valid token authenticates", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(updateMock).toHaveBeenCalled();
    });

    it("skips the lastUsedAt write when the stored value is still fresh", async () => {
      const rawToken = generateRawToken();
      const justNow = new Date();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
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

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, lastUsedAt: longAgo }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(updateMock).toHaveBeenCalled();
    });

    it("still sets userId when the lastUsedAt update fails", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
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

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("throws 401 for a revoked mp_live_ token", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("authenticates a token with a NULL expiresAt (legacy, no expiry)", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("authenticates a token with a future expiresAt", async () => {
      const rawToken = generateRawToken();
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt: future }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("throws 401 for a token with a past expiresAt", async () => {
      const rawToken = generateRawToken();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt: past }]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not update lastUsedAt for an expired token", async () => {
      const rawToken = generateRawToken();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt: past }]);

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(updateMock).not.toHaveBeenCalled();
    });

    it("does not call Clerk for mp_live_ tokens", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it("queries the database with an exact hash lookup, not a full table scan", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
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

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, scopes: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenScopes).toBeNull();
    });

    it("carries the token's scopes array through to context", async () => {
      const rawToken = generateRawToken();
      const scopes = ["records:read", "records:write"];

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, scopes }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenScopes).toEqual(scopes);
    });

    it("sets tokenScopes to null for a Clerk session (always full access)", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
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

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toEqual(expiresAt);
    });

    it("sets tokenExpiresAt to null for a token that never expires", async () => {
      const rawToken = generateRawToken();

      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId, expiresAt: null }]);
      stubUpdateSuccess();

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toBeNull();
    });

    it("sets tokenExpiresAt to null for a Clerk session (no token to inherit a lifetime from)", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      const event = buildEvent();
      await handler(event);

      expect(event.context.tokenExpiresAt).toBeNull();
    });
  });

  describe("Clerk JWT authentication", () => {
    it("authenticates a valid Clerk JWT and sets userId", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      const event = buildEvent();
      await handler(event);

      expect(event.context.userId).toBe(userId);
    });

    it("throws 401 for an invalid Clerk JWT", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockRejectedValue(new Error("Invalid token"));

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not query the database for Clerk JWTs", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("sign-up registration", () => {
    it("registers the user on the Clerk path", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(mockEnsureUserRegistered).toHaveBeenCalledWith(userId);
    });

    it("does not run registration for API token authentication", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockEnsureUserRegistered).not.toHaveBeenCalled();
    });

    it("propagates a rejection from registration and leaves userId unset", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
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
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(mockRecordAuthedApiHit).toHaveBeenCalledWith(userId);
    });

    it("spends throttle budget against the resolved userId for an API token", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockRecordAuthedApiHit).toHaveBeenCalledWith(userId);
    });

    it("throws 429 with a Retry-After header once the user is over the limit", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
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
      stubHeaders({ authorization: `Bearer ${rawToken}` });
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

  describe("failed-authentication IP throttle — scoped to API tokens only", () => {
    it("reserves budget for a presented mp_live_ token before verification runs", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockReserveAuthAttempt).toHaveBeenCalledWith(DEFAULT_CLIENT_IP);
    });

    it("never touches the throttle for a Clerk JWT, valid or not (not guessable)", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockResolvedValue({ sub: userId });

      await handler(buildEvent());

      expect(mockReserveAuthAttempt).not.toHaveBeenCalled();
      expect(mockRefundAuthAttempt).not.toHaveBeenCalled();
      // No throttle interaction also means no client-IP resolution work.
      expect(mockGetRequestIP).not.toHaveBeenCalled();
    });

    it("never touches the throttle for a Clerk JWT that fails verification", async () => {
      const clerkToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
      stubHeaders({ authorization: `Bearer ${clerkToken}` });
      mockVerifyToken.mockRejectedValue(new Error("Invalid token"));

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockReserveAuthAttempt).not.toHaveBeenCalled();
      expect(mockRefundAuthAttempt).not.toHaveBeenCalled();
    });

    it("rejects with 429 before running verification when the reservation is over budget", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      mockReserveAuthAttempt.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 30,
      });

      const event = buildEvent();
      await expect(handler(event)).rejects.toThrow();

      expect(mockCreateError).toHaveBeenCalledWith(
        expectedAuthFailureThrottleEnvelope,
      );
      expect(mockSetHeader).toHaveBeenCalledWith(event, "Retry-After", "30");
      // The whole point of reserving up front: an over-budget IP never gets
      // its guess evaluated at all, correct or not.
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("refunds budget once a reserved API token attempt succeeds", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockRefundAuthAttempt).toHaveBeenCalledWith(DEFAULT_CLIENT_IP);
    });

    it("does not refund budget when a reserved API token attempt fails (budget stays spent)", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockRefundAuthAttempt).not.toHaveBeenCalled();
    });

    it("refunds budget when credential resolution itself throws (an infrastructure error, not a wrong guess)", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectFailure(new Error("connection reset"));

      await expect(handler(buildEvent())).rejects.toThrow("connection reset");

      expect(mockRefundAuthAttempt).toHaveBeenCalledWith(DEFAULT_CLIENT_IP);
    });

    it("still propagates the original error after refunding on a thrown credential-resolution failure", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectFailure(new Error("connection reset"));

      await expect(handler(buildEvent())).rejects.toThrow("connection reset");

      // The refund must not swallow or replace the real error with the
      // throttle's own 401/429 handling.
      expect(mockCreateError).not.toHaveBeenCalled();
    });

    it("gives the normal 401 (not 429) for a failed API token attempt that stayed within the reservation's budget", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      stubSelectResult([]);
      mockReserveAuthAttempt.mockResolvedValue({ allowed: true });

      await expect(handler(buildEvent())).rejects.toThrow();

      expect(mockCreateError).toHaveBeenCalledWith(
        expectedUnauthorizedEnvelope,
      );
    });

    it("does not reserve or refund when no client IP can be resolved", async () => {
      const rawToken = generateRawToken();
      stubHeaders({
        authorization: `Bearer ${rawToken}`,
        clientIp: undefined,
      });
      mockGetRequestIP.mockReturnValue(undefined);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockReserveAuthAttempt).not.toHaveBeenCalled();
      expect(mockRefundAuthAttempt).not.toHaveBeenCalled();
      // Skipping the throttle must never skip authentication itself.
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(selectMock).toHaveBeenCalled();
    });
  });

  describe("failed-authentication IP throttle — client IP resolution", () => {
    it("prefers the Netlify client-connection-IP header over the socket-derived fallback", async () => {
      const rawToken = generateRawToken();
      stubHeaders({ authorization: `Bearer ${rawToken}` });
      mockGetRequestIP.mockReturnValue("198.51.100.9");
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      expect(mockReserveAuthAttempt).toHaveBeenCalledWith(DEFAULT_CLIENT_IP);
      expect(mockGetRequestIP).not.toHaveBeenCalled();
    });

    it("falls back to getRequestIP without trusting X-Forwarded-For when the Netlify header is absent", async () => {
      const rawToken = generateRawToken();
      const socketIp = "198.51.100.9";
      stubHeaders({
        authorization: `Bearer ${rawToken}`,
        clientIp: undefined,
      });
      mockGetRequestIP.mockReturnValue(socketIp);
      stubSelectResult([{ id: tokenId, userId }]);
      stubUpdateSuccess();

      await handler(buildEvent());

      // No xForwardedFor option: a client-suppliable X-Forwarded-For header
      // must never be trusted to key this limiter, since a script could set
      // a fresh value on every request to mint itself a fresh bucket each
      // time, defeating the limiter entirely.
      expect(mockGetRequestIP).toHaveBeenCalledWith(expect.anything());
      expect(mockGetRequestIP).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ xForwardedFor: true }),
      );
      expect(mockReserveAuthAttempt).toHaveBeenCalledWith(socketIp);
    });
  });
});
