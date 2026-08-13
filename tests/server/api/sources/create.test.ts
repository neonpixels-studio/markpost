import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { ApiError } from "../../../../server/utils/errors";

const insertMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ insert: insertMock }),
}));

// The Hobby plan cap check is a separate concern with its own test coverage
// (tests/server/utils/planLimits.test.ts); mock it here so these tests focus
// on request handling and default to "within limit".
const mockAssertWithinSourceLimit = vi.fn();

vi.mock("../../../../server/utils/planLimits", () => ({
  assertWithinSourceLimit: (...args: unknown[]) =>
    mockAssertWithinSourceLimit(...args),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();
const mockSetResponseStatus = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/sources/index.post"))
  .default;

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

function buildBody(attributes: Record<string, unknown>) {
  return { data: { type: "sources", attributes } };
}

function stubInsertResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const values = vi.fn(() => ({ returning }));
  insertMock.mockReturnValue({ values });
  return { values, returning };
}

function expectRouteFolderError(detail: string) {
  expect(mockCreateError).toHaveBeenCalledWith({
    statusCode: 422,
    data: {
      errors: [
        {
          status: "422",
          title: "Invalid Attribute",
          detail,
          source: { pointer: "/data/attributes/routeFolder" },
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  mockSetResponseStatus.mockClear();
  insertMock.mockReset();
  mockAssertWithinSourceLimit.mockReset();
  mockAssertWithinSourceLimit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/sources", () => {
  it("returns a 201 with the serialized source on valid input", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );
    stubInsertResult([sampleSource]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(response).toEqual({
      data: {
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
    });
  });

  it("throws 422 when type is missing", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ name: "My Webhook", routeFolder: "99-incoming/" }),
    );

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
            detail: "Type is required",
            source: { pointer: "/data/attributes/type" },
          },
        ],
      },
    });
  });

  it("throws 422 when name is missing", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ type: "webhook", routeFolder: "99-incoming/" }),
    );

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
            detail: "Name is required",
            source: { pointer: "/data/attributes/name" },
          },
        ],
      },
    });
  });

  it("throws 422 when routeFolder is missing", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ type: "webhook", name: "My Webhook" }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError("RouteFolder is required");
  });

  it("throws 422 when routeFolder contains path traversal", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "../../etc",
      }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder must not contain path traversal segments (..)",
    );
  });

  it("throws 422 when routeFolder is an absolute path", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "/etc/passwd",
      }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder must be a relative path — no leading slash or backslash",
    );
  });

  it("throws 422 when routeFolder contains hazardous characters", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "notes\\work",
      }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder may only contain letters, numbers, spaces, and . _ - /",
    );
  });

  it("accepts a legitimate nested routeFolder", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "notes/work",
      }),
    );
    const { values } = stubInsertResult([
      { ...sampleSource, routeFolder: "notes/work" },
    ]);

    await handler(buildEvent(userId));

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ routeFolder: "notes/work" }),
    );
  });

  it("throws 422 when routeFolder is whitespace-only (slips past the required check)", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({ type: "webhook", name: "My Webhook", routeFolder: "   " }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError("RouteFolder must not be empty");
  });

  it("throws 422 when routeFolder exceeds the max length", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "a".repeat(256),
      }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError("RouteFolder must be at most 255 characters");
  });

  it("throws 422 when a routeFolder segment is a reserved device name", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "notes/CON",
      }),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder must not use a reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)",
    );
  });

  it("persists the NFC-normalized routeFolder for an NFD input", async () => {
    const nfd = `a${String.fromCharCode(0x006e, 0x0303)}o/notes`;
    mockReadBody.mockResolvedValue(
      buildBody({ type: "webhook", name: "My Webhook", routeFolder: nfd }),
    );
    const { values } = stubInsertResult([
      { ...sampleSource, routeFolder: nfd.normalize("NFC") },
    ]);

    await handler(buildEvent(userId));

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ routeFolder: nfd.normalize("NFC") }),
    );
    // The stored value must not carry the raw combining mark the charset forbids.
    expect(values).not.toHaveBeenCalledWith(
      expect.objectContaining({ routeFolder: nfd }),
    );
  });

  it("throws 422 when type is not a recognised source type", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "unknown-type",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );

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
            detail: expect.stringContaining("Type must be one of"),
            source: { pointer: "/data/attributes/type" },
          },
        ],
      },
    });
  });

  it("accepts provider: null without throwing", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
        provider: null,
      }),
    );
    stubInsertResult([sampleSource]);

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(response).toMatchObject({ data: { type: "sources" } });
  });

  it("throws 422 when provider is not a string or null", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
        provider: 123,
      }),
    );

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
            detail: "Provider must be a string",
            source: { pointer: "/data/attributes/provider" },
          },
        ],
      },
    });
  });

  it("throws 422 when type is 'rss' (RSS/Atom polling is not implemented)", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "rss",
        name: "My Feed",
        routeFolder: "99-incoming/",
      }),
    );

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
            detail: expect.stringContaining("Type must be one of"),
            source: { pointer: "/data/attributes/type" },
          },
        ],
      },
    });

    const call = mockCreateError.mock.calls[0] as [
      { data: { errors: [{ detail: string }] } },
    ];
    expect(call[0].data.errors[0].detail).not.toContain("rss");
  });

  describe("provider derivation and secret generation", () => {
    it("derives provider from type and generates a plaintext providerSecret for github", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "github",
          name: "My Source",
          routeFolder: "99-incoming/",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, type: "github", provider: "github" },
      ]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.provider).toBe("github");
      // GitHub verifies via HMAC, which needs the raw secret at verify time,
      // so it is stored in plaintext (unlike zapier/shortcuts — see below).
      expect(insertedValues.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    });

    it.each(["zapier", "shortcuts"])(
      "derives provider from type and stores only a hash of the generated secret for %s",
      async (type) => {
        mockReadBody.mockResolvedValue(
          buildBody({ type, name: "My Source", routeFolder: "99-incoming/" }),
        );
        const { values } = stubInsertResult([
          { ...sampleSource, type, provider: type },
        ]);

        await handler(buildEvent(userId));

        const insertedValues = (
          values.mock.calls[0] as [Record<string, unknown>]
        )[0];
        expect(insertedValues.provider).toBe(type);
        // Compared by equality only (never HMAC'd), so only a SHA-256 hash is
        // stored — 64 hex chars, not the 48-char generated plaintext.
        expect(insertedValues.providerSecret).toMatch(/^[0-9a-f]{64}$/);
      },
    );

    it("throws 422 when creating a stripe source without a providerSecret", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
        }),
      );

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
              detail: expect.stringContaining("providerSecret is required"),
              source: { pointer: "/data/attributes/providerSecret" },
            },
          ],
        },
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("throws 422 when creating a stripe source with a whitespace-only providerSecret", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
          providerSecret: "   ",
        }),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("stores the user-supplied providerSecret verbatim for stripe (not generated)", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
          providerSecret: "whsec_user_supplied_secret",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, type: "stripe", provider: "stripe" },
      ]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.provider).toBe("stripe");
      expect(insertedValues.providerSecret).toBe("whsec_user_supplied_secret");
    });

    it("throws 422 when providerSecret is not a string", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
          providerSecret: 12345,
        }),
      );

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
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("treats providerSecret: null as absent for a webhook source (stores null, no error)", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
          providerSecret: null,
        }),
      );
      const { values } = stubInsertResult([sampleSource]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.providerSecret).toBeNull();
    });

    it("treats providerSecret: null as absent for stripe — reports the required error, not a type error", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
          providerSecret: null,
        }),
      );

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
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("does not derive a provider for the generic webhook type", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
        }),
      );
      const { values } = stubInsertResult([sampleSource]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.provider).toBeNull();
      expect(insertedValues.providerSecret).toBeNull();
    });

    it.each(["", "   "])(
      "treats an empty/whitespace-only explicit provider (%j) as absent and falls back to type derivation",
      async (provider) => {
        mockReadBody.mockResolvedValue(
          buildBody({
            type: "github",
            name: "My Source",
            routeFolder: "99-incoming/",
            provider,
          }),
        );
        const { values } = stubInsertResult([
          { ...sampleSource, type: "github", provider: "github" },
        ]);

        await handler(buildEvent(userId));

        const insertedValues = (
          values.mock.calls[0] as [Record<string, unknown>]
        )[0];
        expect(insertedValues.provider).toBe("github");
      },
    );

    it("an explicit provider wins over the type-derived one and still generates a secret", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
          provider: "github",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, provider: "github" },
      ]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.provider).toBe("github");
      expect(insertedValues.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    });

    it("normalizes an explicit provider's casing/whitespace before deriving and validating it", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
          provider: " GitHub ",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, provider: "github" },
      ]);

      await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.provider).toBe("github");
      expect(insertedValues.providerSecret).toMatch(/^[0-9a-f]{48}$/);
    });

    it("throws 422 for an explicit provider that is not one this backend can verify", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
          provider: "mailchimp",
        }),
      );

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
              detail: expect.stringContaining("Provider must be one of"),
              source: { pointer: "/data/attributes/provider" },
            },
          ],
        },
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("reveals the generated providerSecret in the create response for github", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "github",
          name: "My GitHub Source",
          routeFolder: "99-incoming/",
        }),
      );
      stubInsertResult([
        {
          ...sampleSource,
          type: "github",
          provider: "github",
        },
      ]);

      const response = await handler(buildEvent(userId));

      expect(
        (response as { data: { attributes: { providerSecret: string } } }).data
          .attributes.providerSecret,
      ).toMatch(/^[0-9a-f]{48}$/);
    });

    it("reveals the plaintext providerSecret for zapier even though only a hash is stored", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "zapier",
          name: "My Zapier Source",
          routeFolder: "99-incoming/",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, type: "zapier", provider: "zapier" },
      ]);

      const response = await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      const revealedSecret = (
        response as { data: { attributes: { providerSecret: string } } }
      ).data.attributes.providerSecret;

      expect(revealedSecret).toMatch(/^[0-9a-f]{48}$/);
      // What's stored is a 64-char hash, never equal to the 48-char plaintext.
      expect(insertedValues.providerSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(insertedValues.providerSecret).not.toBe(revealedSecret);
    });

    it("never echoes the user-supplied stripe providerSecret back in the response", async () => {
      // Unlike github/zapier/shortcuts (server-generated, revealed once since
      // the user has no other way to see it), the user already has their own
      // Stripe secret — echoing it back would only add it to the response
      // body/logs/devtools for no benefit.
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "stripe",
          name: "My Stripe Source",
          routeFolder: "99-incoming/",
          providerSecret: "whsec_user_supplied_secret",
        }),
      );
      const { values } = stubInsertResult([
        { ...sampleSource, type: "stripe", provider: "stripe" },
      ]);

      const response = await handler(buildEvent(userId));

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.providerSecret).toBe("whsec_user_supplied_secret");
      expect(response).toMatchObject({
        data: { attributes: { providerSecret: null } },
      });
    });

    it("throws 422 when providerSecret is supplied for a provider that generates its own (github)", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "github",
          name: "My GitHub Source",
          routeFolder: "99-incoming/",
          providerSecret: "my_existing_repo_secret",
        }),
      );

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
              detail: expect.stringContaining("only accepted"),
              source: { pointer: "/data/attributes/providerSecret" },
            },
          ],
        },
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("throws 422 when providerSecret is supplied without a secret-capable provider", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
          providerSecret: "should-not-be-accepted",
        }),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("does not reveal a providerSecret for a plain webhook source (none generated)", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({
          type: "webhook",
          name: "My Webhook",
          routeFolder: "99-incoming/",
        }),
      );
      stubInsertResult([sampleSource]);

      const response = await handler(buildEvent(userId));

      expect(response).toMatchObject({
        data: { attributes: { providerSecret: null } },
      });
    });

    it("generates a different secret for each source created in sequence", async () => {
      mockReadBody.mockResolvedValue(
        buildBody({ type: "github", name: "A", routeFolder: "99-incoming/" }),
      );
      const first = stubInsertResult([{ ...sampleSource, provider: "github" }]);
      await handler(buildEvent(userId));
      const firstSecret = (
        first.values.mock.calls[0] as [Record<string, unknown>]
      )[0].providerSecret;

      const second = stubInsertResult([
        { ...sampleSource, provider: "github" },
      ]);
      await handler(buildEvent(userId));
      const secondSecret = (
        second.values.mock.calls[0] as [Record<string, unknown>]
      )[0].providerSecret;

      expect(firstSecret).not.toBe(secondSecret);
    });
  });

  it("retries on a unique-slug collision and returns the source on success", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );

    const uniqueViolation = Object.assign(new Error("unique"), {
      code: "23505",
    });
    const returningSuccess = vi.fn(() => Promise.resolve([sampleSource]));
    const returningFail = vi.fn(() => Promise.reject(uniqueViolation));
    const values = vi
      .fn()
      .mockReturnValueOnce({ returning: returningFail })
      .mockReturnValue({ returning: returningSuccess });
    insertMock.mockReturnValue({ values });

    const response = await handler(buildEvent(userId));

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(response).toMatchObject({ data: { type: "sources" } });
    expect(values).toHaveBeenCalledTimes(2);
  });

  it("throws 409 after exhausting all slug-collision retries", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );

    const uniqueViolation = Object.assign(new Error("unique"), {
      code: "23505",
    });
    const returning = vi.fn(() => Promise.reject(uniqueViolation));
    const values = vi.fn(() => ({ returning }));
    insertMock.mockReturnValue({ values });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 409,
      data: { errors: expect.any(Array) },
    });
  });

  it("propagates non-unique-violation DB errors without retrying", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );

    const dbError = Object.assign(new Error("connection failed"), {
      code: "08000",
    });
    const returning = vi.fn(() => Promise.reject(dbError));
    const values = vi.fn(() => ({ returning }));
    insertMock.mockReturnValue({ values });

    await expect(handler(buildEvent(userId))).rejects.toThrow();
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("checks the Hobby source cap for the authenticated user before inserting", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );
    stubInsertResult([sampleSource]);

    await handler(buildEvent(userId));

    expect(mockAssertWithinSourceLimit).toHaveBeenCalledWith(userId);
    expect(insertMock).toHaveBeenCalled();
  });

  it("blocks the write with whatever error assertWithinSourceLimit throws when the Hobby cap is reached", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );
    mockAssertWithinSourceLimit.mockRejectedValue(
      new ApiError(
        [
          {
            status: "403",
            title: "Plan Limit Reached",
            detail:
              "You've reached the Hobby plan limit of 1 connected source. Upgrade to Pro for unlimited usage.",
          },
        ],
        403,
      ),
    );

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockReadBody.mockResolvedValue(
      buildBody({
        type: "webhook",
        name: "My Webhook",
        routeFolder: "99-incoming/",
      }),
    );

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
