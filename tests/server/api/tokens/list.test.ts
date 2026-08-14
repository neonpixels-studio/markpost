import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/tokens/index.get");

const userId = "user_abc123";

const tokenOne = {
  id: "token-id-1",
  name: "obsidian-laptop",
  prefix: "mp_live_abcd",
  createdAt: new Date("2026-04-01T00:00:00Z"),
  lastUsedAt: new Date("2026-06-01T00:00:00Z"),
  expiresAt: new Date("2026-09-01T00:00:00Z"),
};

const tokenTwo = {
  id: "token-id-2",
  name: "home-server",
  prefix: "mp_live_efgh",
  createdAt: new Date("2026-03-01T00:00:00Z"),
  lastUsedAt: null,
  expiresAt: null,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubSelectResult(rows: unknown[]) {
  const orderBy = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, orderBy };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  mockCreateError.mockClear();
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/tokens", () => {
  it("returns a list of serialized tokens for the authenticated user", async () => {
    stubSelectResult([tokenOne, tokenTwo]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: [
        {
          type: "api_tokens",
          id: tokenOne.id,
          attributes: {
            name: tokenOne.name,
            prefix: tokenOne.prefix,
            createdAt: tokenOne.createdAt,
            lastUsedAt: tokenOne.lastUsedAt,
            expiresAt: tokenOne.expiresAt,
          },
        },
        {
          type: "api_tokens",
          id: tokenTwo.id,
          attributes: {
            name: tokenTwo.name,
            prefix: tokenTwo.prefix,
            createdAt: tokenTwo.createdAt,
            lastUsedAt: null,
            expiresAt: null,
          },
        },
      ],
    });
  });

  it("still returns an expired-but-unrevoked token (list includes it so the owner can clean it up)", async () => {
    const expiredToken = {
      id: "token-id-3",
      name: "old-laptop",
      prefix: "mp_live_wxyz",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      lastUsedAt: new Date("2026-02-01T00:00:00Z"),
      expiresAt: new Date("2026-03-01T00:00:00Z"),
    };
    stubSelectResult([expiredToken]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: [
        {
          type: "api_tokens",
          id: expiredToken.id,
          attributes: {
            name: expiredToken.name,
            prefix: expiredToken.prefix,
            createdAt: expiredToken.createdAt,
            lastUsedAt: expiredToken.lastUsedAt,
            expiresAt: expiredToken.expiresAt,
          },
        },
      ],
    });
  });

  it("returns an empty list when the user has no active tokens", async () => {
    stubSelectResult([]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({ data: [] });
  });

  it("never includes hashed_token or plaintext token in the response", async () => {
    stubSelectResult([{ ...tokenOne, hashedToken: "secret-hash" }]);

    const response = await handler(buildEvent(userId));

    const responseString = JSON.stringify(response);
    expect(responseString).not.toContain("hashedToken");
    expect(responseString).not.toContain("secret-hash");
  });

  it("throws 401 when the user is not authenticated", async () => {
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
