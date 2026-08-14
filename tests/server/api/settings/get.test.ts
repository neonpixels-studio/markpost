import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const selectMock = vi.fn();
const insertMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock, insert: insertMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const routeModule = await import("../../../../server/api/settings/index.get");
const handler = routeModule.default;
const findUserSettings = routeModule.findUserSettings;
const createDefaultSettings = routeModule.createDefaultSettings;

const userId = "user_abc123";

const sampleSettings = {
  userId,
  vaultDir: "~/Documents/Vault",
  filenameTemplate: "{{date}}-{{slug}}.md",
  autoSync: true,
  autoDelete: true,
  frontmatter: true,
  conflictStrategy: "suffix",
  theme: "system",
  accentColor: "#a855f7",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubSelectResult(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

function stubInsertResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoNothing, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  mockCreateError.mockClear();
  selectMock.mockReset();
  insertMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findUserSettings", () => {
  it("returns the settings row when one exists for the user", async () => {
    stubSelectResult([sampleSettings]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await findUserSettings(db, userId);

    expect(result).toEqual(sampleSettings);
  });

  it("returns null when no row exists for the user", async () => {
    stubSelectResult([]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await findUserSettings(db, userId);

    expect(result).toBeNull();
  });
});

describe("createDefaultSettings", () => {
  it("inserts a row with the given userId and returns it", async () => {
    const { values, returning } = stubInsertResult([sampleSettings]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await createDefaultSettings(db, userId);

    expect(values).toHaveBeenCalledWith({ userId });
    expect(returning).toHaveBeenCalled();
    expect(result).toEqual(sampleSettings);
  });

  it("falls back to a select when insert conflicts (concurrent request race)", async () => {
    stubInsertResult([]);
    stubSelectResult([sampleSettings]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await createDefaultSettings(db, userId);

    expect(selectMock).toHaveBeenCalled();
    expect(result).toEqual(sampleSettings);
  });
});

describe("GET /api/settings", () => {
  it("returns the existing settings when a row already exists", async () => {
    stubSelectResult([sampleSettings]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        type: "user_settings",
        id: userId,
        attributes: {
          userId,
          vaultDir: sampleSettings.vaultDir,
          filenameTemplate: sampleSettings.filenameTemplate,
          autoSync: sampleSettings.autoSync,
          autoDelete: sampleSettings.autoDelete,
          frontmatter: sampleSettings.frontmatter,
          conflictStrategy: sampleSettings.conflictStrategy,
          theme: sampleSettings.theme,
          accentColor: sampleSettings.accentColor,
          updatedAt: sampleSettings.updatedAt,
        },
        links: { self: "/api/settings" },
      },
    });
  });

  it("creates default settings when no row exists and returns them", async () => {
    stubSelectResult([]);
    stubInsertResult([sampleSettings]);

    const response = await handler(buildEvent(userId));

    expect(insertMock).toHaveBeenCalled();
    expect(response).toEqual({
      data: {
        type: "user_settings",
        id: userId,
        attributes: expect.objectContaining({ userId }),
        links: { self: "/api/settings" },
      },
    });
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
