import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { generateRawToken, hashToken } from "../../../server/utils/tokens";
import { stubFailingUpdate, spyConsoleError } from "../helpers";

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

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } = await import("../../../server/middleware/auth");

const userId = "user_abc123";
const tokenId = "token-uuid-1";

function buildEvent(path: string = "/api/records"): H3Event & {
  context: { userId?: string };
} {
  return { path, context: {} } as unknown as H3Event & {
    context: { userId?: string };
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
  mockCreateError.mockClear();
  mockGetHeader.mockClear();
  selectMock.mockReset();
  updateMock.mockReset();
  mockVerifyToken.mockReset();
  mockEnsureUserRegistered.mockReset();
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
      },
    );
  });

  describe("missing token", () => {
    it("throws 401 when the Authorization header is absent", async () => {
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
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
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    });

    it("throws 401 for a revoked mp_live_ token", async () => {
      const rawToken = generateRawToken();

      mockGetHeader.mockReturnValue(`Bearer ${rawToken}`);
      stubSelectResult([]);

      await expect(handler(buildEvent())).rejects.toThrow();
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
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
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
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
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
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
    });
  });
});
