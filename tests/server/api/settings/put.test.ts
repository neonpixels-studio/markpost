import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const insertMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ insert: insertMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const routeModule = await import("../../../../server/api/settings/index.put");
const handler = routeModule.default;
const upsertUserSettings = routeModule.upsertUserSettings;

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

function buildBody(attributes: Record<string, unknown>) {
  return { data: { type: "user_settings", attributes } };
}

function stubUpsertResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoUpdate, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  insertMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("upsertUserSettings", () => {
  it("calls insert with the userId and attributes and returns the result", async () => {
    const { values, onConflictDoUpdate, returning } = stubUpsertResult([
      sampleSettings,
    ]);
    const attributes = { vaultDir: "~/Notes", autoSync: false };

    const db = (await import("../../../../server/db")).getDb();
    const result = await upsertUserSettings(db, userId, attributes);

    expect(values).toHaveBeenCalledWith({ userId, ...attributes });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
    expect(returning).toHaveBeenCalled();
    expect(result).toEqual(sampleSettings);
  });

  it("does not pass unknown attributes or userId from body to the database", async () => {
    const { values } = stubUpsertResult([sampleSettings]);
    const maliciousAttributes = {
      vaultDir: "~/Notes",
      userId: "attacker_id",
      unknownField: "injected",
    } as Record<string, unknown>;

    const db = (await import("../../../../server/db")).getDb();
    await upsertUserSettings(
      db,
      userId,
      maliciousAttributes as Parameters<typeof upsertUserSettings>[2],
    );

    const insertedValues = (values as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(insertedValues.userId).toBe(userId);
    expect(insertedValues).not.toHaveProperty("unknownField");
  });

  it("does not write empty strings to the database (preserves NOT NULL defaults)", async () => {
    const { values } = stubUpsertResult([sampleSettings]);
    const attributes = {
      vaultDir: "",
      filenameTemplate: "",
      theme: "dark",
    } as Parameters<typeof upsertUserSettings>[2];

    const db = (await import("../../../../server/db")).getDb();
    await upsertUserSettings(db, userId, attributes);

    const insertedValues = (values as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(insertedValues).not.toHaveProperty("vaultDir");
    expect(insertedValues).not.toHaveProperty("filenameTemplate");
    expect(insertedValues.theme).toBe("dark");
  });

  it("does not write null to the database (prevents NOT NULL constraint violation)", async () => {
    const { values } = stubUpsertResult([sampleSettings]);
    const attributes = {
      vaultDir: null as unknown as string,
      autoSync: null as unknown as boolean,
      theme: "dark",
    } as Parameters<typeof upsertUserSettings>[2];

    const db = (await import("../../../../server/db")).getDb();
    await upsertUserSettings(db, userId, attributes);

    const insertedValues = (values as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(insertedValues).not.toHaveProperty("vaultDir");
    expect(insertedValues).not.toHaveProperty("autoSync");
    expect(insertedValues.theme).toBe("dark");
  });
});

describe("PUT /api/settings", () => {
  it("returns the updated settings on valid input", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        vaultDir: "~/Notes",
        filenameTemplate: "{{slug}}.md",
        autoSync: false,
        autoDelete: false,
        frontmatter: false,
        conflictStrategy: "overwrite",
        theme: "dark",
        accentColor: "#6366f1",
      }),
    );
    stubUpsertResult([{ ...sampleSettings, vaultDir: "~/Notes" }]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: expect.objectContaining({
        type: "user_settings",
        id: userId,
      }),
    });
  });

  it("accepts a partial update with only some attributes provided", async () => {
    mockReadBody.mockResolvedValue(buildBody({ vaultDir: "~/Notes" }));
    stubUpsertResult([{ ...sampleSettings, vaultDir: "~/Notes" }]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: expect.objectContaining({ type: "user_settings" }),
    });
  });

  it("throws a 422 when conflictStrategy is not a valid enum value", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ conflictStrategy: "invalid_value" }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            status: "422",
            detail: expect.stringContaining("suffix"),
          }),
        ],
      },
    });
  });

  it("throws a 422 when theme is not a valid enum value", async () => {
    mockReadBody.mockResolvedValue(buildBody({ theme: "neon" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            status: "422",
            detail: expect.stringContaining("light"),
          }),
        ],
      },
    });
  });

  it("throws a 422 when autoSync is not a boolean", async () => {
    mockReadBody.mockResolvedValue(buildBody({ autoSync: "yes" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: {
        errors: [
          expect.objectContaining({
            status: "422",
            detail: "AutoSync must be a boolean",
          }),
        ],
      },
    });
  });

  it("throws a 401 when the user is not authenticated", async () => {
    mockReadBody.mockResolvedValue(buildBody({ vaultDir: "~/Notes" }));

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

  it("accepts an empty attributes object without throwing", async () => {
    mockReadBody.mockResolvedValue(buildBody({}));
    stubUpsertResult([sampleSettings]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: expect.objectContaining({ type: "user_settings" }),
    });
  });
});
