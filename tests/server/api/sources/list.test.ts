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
  await import("../../../../server/api/sources/index.get");

const userId = "user_abc123";

const sampleSource = {
  uuid: "550e8400-e29b-41d4-a716-446655440001",
  userId,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  type: "webhook",
  name: "My Webhook",
  provider: null,
  endpointSlug: "wh_8f2a91c4",
  routeFolder: "99-incoming/",
  fieldMapping: null,
  lastHitAt: null,
  recordCount: 0,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubSelectResult(rows: unknown[]) {
  const where = vi.fn(() => Promise.resolve(rows));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where };
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

describe("GET /api/sources", () => {
  it("returns a list of serialized sources for the authenticated user", async () => {
    stubSelectResult([sampleSource]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: [
        {
          type: "sources",
          id: sampleSource.uuid,
          attributes: {
            uuid: sampleSource.uuid,
            userId,
            createdAt: sampleSource.createdAt,
            type: sampleSource.type,
            name: sampleSource.name,
            provider: null,
            providerSecret: null,
            endpointSlug: sampleSource.endpointSlug,
            routeFolder: sampleSource.routeFolder,
            fieldMapping: null,
            lastHitAt: null,
            recordCount: 0,
          },
          links: { self: `/api/sources/${sampleSource.uuid}` },
        },
      ],
    });
  });

  it("returns an empty data array when the user has no sources", async () => {
    stubSelectResult([]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({ data: [] });
  });

  it("never reveals providerSecret, even when the underlying row has one", async () => {
    stubSelectResult([
      { ...sampleSource, provider: "github", providerSecret: "leaked-secret" },
    ]);

    const response = await handler(buildEvent(userId));

    expect(response.data[0]?.attributes.providerSecret).toBeNull();
  });

  it("throws a 401 when the user is not authenticated", async () => {
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
