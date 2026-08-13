import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { createMockCreateError } from "../helpers";

const selectMock = vi.fn();
const insertMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock, insert: insertMock }),
}));

const runtimeConfig = { disableSignups: "" };
const mockCreateError = createMockCreateError();

const { signupsDisabled, ensureUserRegistered, requireUser } =
  await import("../../../server/utils/auth");

function buildEvent(contextUserId?: string): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

const userId = "user_abc123";

function stubUserLookup(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

function stubInsert() {
  const onConflictDoNothing = vi.fn(() => Promise.resolve());
  const values = vi.fn(() => ({ onConflictDoNothing }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoNothing };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  mockCreateError.mockClear();
  selectMock.mockReset();
  insertMock.mockReset();
  runtimeConfig.disableSignups = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requireUser", () => {
  it("returns the userId from the event context when present", () => {
    expect(requireUser(buildEvent(userId))).toBe(userId);
  });

  it("throws a 401 carrying the JSON:API { errors: [...] } envelope when absent", () => {
    expect(() => requireUser(buildEvent(undefined))).toThrow();

    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({
            status: "401",
            title: "Unauthorized",
            detail: "Authentication is required to access this resource.",
          }),
        ],
      },
    });
  });
});

describe("signupsDisabled", () => {
  it("is false when the flag is empty", () => {
    runtimeConfig.disableSignups = "";
    expect(signupsDisabled()).toBe(false);
  });

  it("is false for any value other than the string 'true'", () => {
    runtimeConfig.disableSignups = "false";
    expect(signupsDisabled()).toBe(false);
  });

  it("is true only for the string 'true'", () => {
    runtimeConfig.disableSignups = "true";
    expect(signupsDisabled()).toBe(true);
  });
});

describe("ensureUserRegistered", () => {
  it("passes an existing user through without inserting", async () => {
    stubUserLookup([{ userId }]);
    const insert = stubInsert();

    await ensureUserRegistered(userId);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("lets an existing user through even when sign-ups are disabled", async () => {
    runtimeConfig.disableSignups = "true";
    stubUserLookup([{ userId }]);
    const insert = stubInsert();

    await expect(ensureUserRegistered(userId)).resolves.toBeUndefined();
    expect(insert.values).not.toHaveBeenCalled();
  });

  it("registers a new user when sign-ups are enabled", async () => {
    stubUserLookup([]);
    const insert = stubInsert();

    await ensureUserRegistered(userId);

    expect(insert.values).toHaveBeenCalledWith({ userId });
    expect(insert.onConflictDoNothing).toHaveBeenCalled();
  });

  it("rejects a new user with a 403 instead of registering when sign-ups are disabled", async () => {
    runtimeConfig.disableSignups = "true";
    stubUserLookup([]);
    const insert = stubInsert();

    await expect(ensureUserRegistered(userId)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(insert.values).not.toHaveBeenCalled();
  });
});
