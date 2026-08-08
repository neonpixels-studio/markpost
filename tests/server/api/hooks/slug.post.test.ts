import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import {
  buildValidStripeHeader,
  buildValidGithubHeader,
  stubFailingUpdate,
  spyConsoleError,
} from "../../helpers";
import { ApiError } from "../../../../server/utils/errors";
import { hashSharedSecret } from "../../../../server/utils/signatureVerifier";
import { SHARED_SECRET_HEADER } from "#shared/utils/webhookSecrets";

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  isNotNull: (column: unknown) => ({ op: "isNotNull", column }),
  ilike: (column: unknown, pattern: unknown) => ({
    op: "ilike",
    column,
    pattern,
  }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

const mockWriteEvent = vi.fn();

vi.mock("../../../../server/utils/eventWriter", () => ({
  writeEvent: (...args: unknown[]) => mockWriteEvent(...args),
}));

// The Hobby plan cap check is a separate concern with its own test coverage
// (tests/server/utils/planLimits.test.ts); mock it here so these tests focus
// on request handling and default to "within limit".
const mockAssertWithinRecordLimit = vi.fn();

vi.mock("../../../../server/utils/planLimits", () => ({
  assertWithinRecordLimit: (...args: unknown[]) =>
    mockAssertWithinRecordLimit(...args),
}));

const mockRecordWebhookHit = vi.fn();

vi.mock("../../../../server/utils/webhookThrottle", () => ({
  recordWebhookHit: (...args: unknown[]) => mockRecordWebhookHit(...args),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadRawBody = vi.fn();
const mockGetHeader = vi.fn();
const mockGetRouterParam = vi.fn();
const mockSetResponseStatus = vi.fn();
const mockSetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/hooks/[slug].post"))
  .default;

const SOURCE_UUID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_abc123";
const SOURCE_NAME = "My Webhook";
const STRIPE_SECRET = "whsec_test_stripe_secret";
const DEFAULT_FILENAME_TEMPLATE = "{{date}}-{{slug}}.md";

const sampleSource = {
  uuid: SOURCE_UUID,
  userId: USER_ID,
  type: "webhook",
  name: SOURCE_NAME,
  provider: null,
  fieldMapping: null,
};

const sampleRecord = {
  uuid: "550e8400-e29b-41d4-a716-446655440002",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  userId: USER_ID,
  title: "Untitled",
  content: "",
  sourceId: SOURCE_UUID,
  source: SOURCE_NAME,
  status: "pending",
  filePath: null,
  tags: [],
  frontmatter: null,
  syncedAt: null,
  errorMessage: null,
};

function buildEvent(): H3Event {
  return { context: {} } as unknown as H3Event;
}

function makeSelectChain(resolvedRows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(resolvedRows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from, where, limit };
}

// The filePath collision lookup resolves at `.where()` (no `.limit()`), unlike
// the source/settings selects that resolve at `.limit()`.
function makeWhereResolvingChain(resolvedRows: unknown[]) {
  const where = vi.fn(() => Promise.resolve(resolvedRows));
  const from = vi.fn(() => ({ where }));
  return { from, where };
}

function stubSourceAndSettings(
  sourceRows: unknown[],
  filenameTemplate = DEFAULT_FILENAME_TEMPLATE,
  collisionRows: unknown[] = [],
) {
  const sourceChain = makeSelectChain(sourceRows);
  const settingsChain = makeSelectChain([{ filenameTemplate }]);
  const collisionChain = makeWhereResolvingChain(collisionRows);

  selectMock
    .mockReturnValueOnce({ from: sourceChain.from })
    .mockReturnValueOnce({ from: settingsChain.from })
    .mockReturnValueOnce({ from: collisionChain.from });

  return { sourceChain, settingsChain, collisionChain };
}

function stubSourceOnly(sourceRows: unknown[]) {
  const sourceChain = makeSelectChain(sourceRows);
  selectMock.mockReturnValueOnce({ from: sourceChain.from });
  return sourceChain;
}

function stubInsertRecord(row: unknown) {
  const returning = vi.fn(() => Promise.resolve([row]));
  const values = vi.fn(() => ({ returning }));
  insertMock.mockReturnValue({ values });
  return { values, returning };
}

function stubUpdateStats() {
  const where = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where };
}

function expect202Success(
  response: unknown,
  mockSetStatus: ReturnType<typeof vi.fn>,
  expectedUuid: string,
): void {
  expect(mockSetStatus).toHaveBeenCalledWith(expect.anything(), 202);
  expect(response).toMatchObject({ data: { uuid: expectedUuid } });
}

async function expectBestEffortFailureHandled(
  setup: () => void,
  rawBody: string = JSON.stringify({ title: "T", content: "C" }),
): Promise<void> {
  stubSourceAndSettings([sampleSource]);
  stubInsertRecord(sampleRecord);
  setup();
  const consoleErrorSpy = spyConsoleError();

  mockReadRawBody.mockResolvedValue(rawBody);

  const response = await handler(buildEvent());

  expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining("[hooks/ingest]"),
    expect.any(Error),
  );

  consoleErrorSpy.mockRestore();
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readRawBody", mockReadRawBody);
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
  vi.stubGlobal("setHeader", mockSetHeader);

  mockCreateError.mockClear();
  mockReadRawBody.mockClear();
  mockGetHeader.mockClear();
  mockGetRouterParam.mockClear();
  mockSetResponseStatus.mockClear();
  mockSetHeader.mockClear();

  selectMock.mockReset();
  insertMock.mockReset();
  updateMock.mockReset();
  mockWriteEvent.mockReset();
  mockWriteEvent.mockResolvedValue(undefined);
  mockAssertWithinRecordLimit.mockReset();
  mockAssertWithinRecordLimit.mockResolvedValue(undefined);
  mockRecordWebhookHit.mockReset();
  mockRecordWebhookHit.mockResolvedValue({ allowed: true });

  mockGetRouterParam.mockReturnValue("wh_abc12345");
  mockGetHeader.mockReturnValue(undefined);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/hooks/[slug]", () => {
  describe("unknown slug", () => {
    it("returns 404 when no source matches the slug", async () => {
      stubSourceOnly([]);
      mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 404,
        data: {
          errors: [
            {
              status: "404",
              title: "Not Found",
              detail: "No source was found for the given slug.",
            },
          ],
        },
      });
    });

    it("returns 404 when the slug router param is missing", async () => {
      mockGetRouterParam.mockReturnValue(undefined);
      mockReadRawBody.mockResolvedValue("");

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404 }),
      );
    });
  });

  describe("valid payload — non-stripe source", () => {
    it("ingests a payload and returns 202 with record uuid", async () => {
      const rawBody = JSON.stringify({
        title: "Deploy succeeded",
        content: "Build #42 passed",
      });

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord({ ...sampleRecord, title: "Deploy succeeded" });
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });

    it("inserts a record with correct sourceId and userId", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceAndSettings([sampleSource]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];

      expect(insertedValues.userId).toBe(USER_ID);
      expect(insertedValues.sourceId).toBe(SOURCE_UUID);
      expect(insertedValues.status).toBe("pending");
    });

    it("appends a suffix when the generated filePath already exists", async () => {
      const rawBody = JSON.stringify({
        title: "Hello",
        content: "C",
        created: "2026-01-01T00:00:00.000Z",
      });

      stubSourceAndSettings([sampleSource], DEFAULT_FILENAME_TEMPLATE, [
        { filePath: "2026-01-01-hello.md" },
      ]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];

      expect(insertedValues.filePath).toBe("2026-01-01-hello-2.md");
    });

    it("keeps the generated filePath when nothing collides", async () => {
      const rawBody = JSON.stringify({
        title: "Hello",
        content: "C",
        created: "2026-01-01T00:00:00.000Z",
      });

      stubSourceAndSettings([sampleSource]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];

      expect(insertedValues.filePath).toBe("2026-01-01-hello.md");
    });

    it("handles a non-JSON body without crashing", async () => {
      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue("not-json");

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });

    it("handles a valid-JSON non-object body (null) without crashing", async () => {
      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue("null");

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });

    it("handles a valid-JSON array body without crashing", async () => {
      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(JSON.stringify([1, 2, 3]));

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });
  });

  describe("stripe signature verification", () => {
    // Stripe issues the signing secret when the user creates their own Stripe
    // webhook endpoint, so — unlike the app's own billing webhook
    // (server/api/billing/webhook.post.ts), which verifies against the
    // app-wide STRIPE_WEBHOOK_SECRET env var — a user-created Stripe SOURCE
    // verifies against the secret they supplied at creation, stored on the
    // row itself (see server/api/sources/index.post.ts).
    const stripeSource = {
      ...sampleSource,
      provider: "stripe",
      providerSecret: STRIPE_SECRET,
    };

    it("returns 401 when Stripe-Signature header is missing", async () => {
      stubSourceOnly([stripeSource]);
      mockReadRawBody.mockResolvedValue(
        JSON.stringify({ type: "charge.succeeded" }),
      );
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    it("returns 401 when Stripe-Signature does not match", async () => {
      const rawBody = JSON.stringify({ type: "charge.succeeded" });

      stubSourceOnly([stripeSource]);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockGetHeader.mockReturnValue(
        buildValidStripeHeader(rawBody, "wrong_secret"),
      );

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    it("returns 202 when Stripe-Signature is valid", async () => {
      const rawBody = JSON.stringify({ type: "charge.succeeded" });
      const validHeader = buildValidStripeHeader(rawBody, STRIPE_SECRET);

      stubSourceAndSettings([stripeSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      mockGetHeader.mockReturnValue(validHeader);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });

    it("returns 401 when the source has no providerSecret configured", async () => {
      const rawBody = JSON.stringify({ type: "charge.succeeded" });

      stubSourceOnly([{ ...stripeSource, providerSecret: null }]);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockGetHeader.mockReturnValue(
        buildValidStripeHeader(rawBody, STRIPE_SECRET),
      );

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    it("does not fall back to STRIPE_WEBHOOK_SECRET when the source's own providerSecret doesn't match", async () => {
      // The app's own billing webhook uses STRIPE_WEBHOOK_SECRET; a user's
      // Stripe SOURCE must never accept a signature made with that env var
      // instead of the secret the user actually configured.
      process.env.STRIPE_WEBHOOK_SECRET = "app-billing-secret-not-this-sources";
      const rawBody = JSON.stringify({ type: "charge.succeeded" });
      const headerSignedWithEnvSecret = buildValidStripeHeader(
        rawBody,
        process.env.STRIPE_WEBHOOK_SECRET,
      );

      stubSourceOnly([stripeSource]);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockGetHeader.mockReturnValue(headerSignedWithEnvSecret);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });

      delete process.env.STRIPE_WEBHOOK_SECRET;
    });
  });

  describe("github signature verification", () => {
    const GITHUB_SECRET = "github_test_secret";
    const githubSource = {
      ...sampleSource,
      provider: "github",
      providerSecret: GITHUB_SECRET,
    };

    function stubGithubHeader(rawBody: string, secret: string): void {
      mockGetHeader.mockImplementation((_event: unknown, name: string) =>
        name === "x-hub-signature-256"
          ? buildValidGithubHeader(rawBody, secret)
          : undefined,
      );
    }

    it("returns 401 when the X-Hub-Signature-256 header is missing", async () => {
      stubSourceOnly([githubSource]);
      mockReadRawBody.mockResolvedValue(JSON.stringify({ ref: "main" }));
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 401 when the signature does not match the source's secret", async () => {
      const rawBody = JSON.stringify({ ref: "main" });
      stubSourceOnly([githubSource]);
      mockReadRawBody.mockResolvedValue(rawBody);
      stubGithubHeader(rawBody, "wrong_secret");

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 202 when the signature matches the source's providerSecret", async () => {
      const rawBody = JSON.stringify({ ref: "main" });
      stubSourceAndSettings([githubSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubGithubHeader(rawBody, GITHUB_SECRET);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });

    it("returns 401 when the source has no providerSecret configured", async () => {
      const rawBody = JSON.stringify({ ref: "main" });
      stubSourceOnly([{ ...githubSource, providerSecret: null }]);
      mockReadRawBody.mockResolvedValue(rawBody);
      stubGithubHeader(rawBody, GITHUB_SECRET);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
    });
  });

  describe("zapier / shortcuts shared-secret verification", () => {
    const SHARED_SECRET = "shared_test_secret";
    // Only the hash is ever stored (see hashSharedSecret / isHashedStorageProvider);
    // the plaintext is what the sender actually presents via the header.
    const STORED_SECRET_HASH = hashSharedSecret(SHARED_SECRET);

    function stubSharedSecretHeader(value: string | undefined): void {
      mockGetHeader.mockImplementation((_event: unknown, name: string) =>
        name === SHARED_SECRET_HEADER ? value : undefined,
      );
    }

    it.each(["zapier", "shortcuts"])(
      "returns 401 for %s when the shared-secret header is missing",
      async (provider) => {
        const source = {
          ...sampleSource,
          provider,
          providerSecret: STORED_SECRET_HASH,
        };
        stubSourceOnly([source]);
        mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));
        stubSharedSecretHeader(undefined);

        await expect(handler(buildEvent())).rejects.toMatchObject({
          statusCode: 401,
        });
      },
    );

    it.each(["zapier", "shortcuts"])(
      "returns 401 for %s when the shared secret does not match",
      async (provider) => {
        const source = {
          ...sampleSource,
          provider,
          providerSecret: STORED_SECRET_HASH,
        };
        stubSourceOnly([source]);
        mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));
        stubSharedSecretHeader("wrong-value");

        await expect(handler(buildEvent())).rejects.toMatchObject({
          statusCode: 401,
        });
      },
    );

    it.each(["zapier", "shortcuts"])(
      "returns 202 for %s when the provided secret hashes to the stored hash",
      async (provider) => {
        const source = {
          ...sampleSource,
          provider,
          providerSecret: STORED_SECRET_HASH,
        };
        stubSourceAndSettings([source]);
        stubInsertRecord(sampleRecord);
        stubUpdateStats();
        mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));
        stubSharedSecretHeader(SHARED_SECRET);

        const response = await handler(buildEvent());

        expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      },
    );
  });

  describe("fieldMapping", () => {
    it("applies stored fieldMapping to map nested payload fields", async () => {
      const mappedSource = {
        ...sampleSource,
        fieldMapping: { title: "event.name", content: "event.body" },
      };
      const rawBody = JSON.stringify({
        event: { name: "Deployment done", body: "All green" },
      });

      stubSourceAndSettings([mappedSource]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.title).toBe("Deployment done");
      expect(insertedValues.content).toBe("All green");
    });
  });

  describe("Hobby plan record cap", () => {
    it("checks the cap for the source's owner before inserting", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      expect(mockAssertWithinRecordLimit).toHaveBeenCalledWith(USER_ID);
      expect(insertMock).toHaveBeenCalled();
    });

    it("blocks ingest with whatever error assertWithinRecordLimit throws when the Hobby cap is reached", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceOnly([sampleSource]);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockAssertWithinRecordLimit.mockRejectedValue(
        new ApiError(
          [
            {
              status: "403",
              title: "Plan Limit Reached",
              detail:
                "You've reached the Hobby plan limit of 100 records per month. Upgrade to Pro for unlimited usage.",
            },
          ],
          403,
        ),
      );

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("still spends throttle budget when the source's owner is over the cap", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceOnly([sampleSource]);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockAssertWithinRecordLimit.mockRejectedValue(
        new ApiError(
          [{ status: "403", title: "Plan Limit Reached", detail: "over cap" }],
          403,
        ),
      );

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 403,
      });
      // The throttle runs first, so a capped user still registers in the rate
      // window instead of throwing past it on every delivery.
      expect(mockRecordWebhookHit).toHaveBeenCalledWith(SOURCE_UUID);
    });
  });

  describe("insert failure", () => {
    it("throws 500 when the DB insert returns no row", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceAndSettings([sampleSource]);

      const returning = vi.fn(() => Promise.resolve([]));
      const values = vi.fn(() => ({ returning }));
      insertMock.mockReturnValue({ values });

      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 500,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500 }),
      );
    });
  });

  describe("source stats update", () => {
    it("does not throw when updateSourceStats fails", async () => {
      await expectBestEffortFailureHandled(() => {
        stubFailingUpdate(updateMock);
      });
    });
  });

  describe("event writing", () => {
    it("calls writeEvent with correct fields on successful ingest", async () => {
      const rawBody = JSON.stringify({
        title: "Deploy done",
        content: "Green",
      });

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord({ ...sampleRecord, title: "Deploy done" });
      const { set: updateSet } = stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      expect(mockWriteEvent).toHaveBeenCalledWith({
        userId: USER_ID,
        kind: "ok",
        message: expect.stringContaining("Deploy done"),
        recordUuid: sampleRecord.uuid,
        sourceId: SOURCE_UUID,
      });
      // The success path writes only the "ok" event: no "err" event, and the
      // record is never marked "error" alongside it.
      expect(mockWriteEvent).toHaveBeenCalledTimes(1);
      expect(updateSet).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: "error" }),
      );
    });

    it("does not throw when writeEvent fails", async () => {
      await expectBestEffortFailureHandled(() => {
        stubUpdateStats();
        mockWriteEvent.mockRejectedValue(new Error("event write error"));
      });
    });

    it("writes an err event and marks the record error when the ok event write fails", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });
      const writeError = new Error("event write error");

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      const { set: updateSet } = stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      mockWriteEvent.mockImplementation((input: { kind: string }) =>
        input.kind === "ok" ? Promise.reject(writeError) : Promise.resolve(),
      );
      const consoleErrorSpy = spyConsoleError();

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(mockWriteEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          kind: "err",
          message: expect.stringContaining("event write error"),
          recordUuid: sampleRecord.uuid,
          sourceId: SOURCE_UUID,
        }),
      );
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          errorMessage: "event write error",
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    it("does not throw when both the ok event write and the record-error mark fail", async () => {
      const rawBody = JSON.stringify({ title: "T", content: "C" });

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubFailingUpdate(updateMock);
      mockReadRawBody.mockResolvedValue(rawBody);
      mockWriteEvent.mockRejectedValue(new Error("event write error"));
      const consoleErrorSpy = spyConsoleError();

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[hooks/ingest] failed to mark record error:"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("does not fabricate a record or write an err event when the failure happens before a record exists", async () => {
      stubSourceOnly([]);
      mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(mockWriteEvent).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });
  });

  describe("throttling", () => {
    it("returns 429 with a Retry-After header when the source is over its limit", async () => {
      stubSourceOnly([sampleSource]);
      mockRecordWebhookHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 42,
      });
      mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 429,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 429,
        data: {
          errors: [expect.objectContaining({ status: "429" })],
        },
      });
      expect(mockSetHeader).toHaveBeenCalledWith(
        expect.anything(),
        "Retry-After",
        "42",
      );
    });

    it("does not insert a record when throttled", async () => {
      stubSourceOnly([sampleSource]);
      mockRecordWebhookHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 10,
      });
      mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 429,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("proceeds to ingest when the source is within its limit", async () => {
      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockRecordWebhookHit.mockResolvedValue({ allowed: true });
      mockReadRawBody.mockResolvedValue(
        JSON.stringify({ title: "T", content: "C" }),
      );

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(mockRecordWebhookHit).toHaveBeenCalledWith(SOURCE_UUID);
    });

    it("verifies the signature before spending throttle budget on a provider source", async () => {
      // HMAC verification is cheap and stateless, so it runs before the throttle
      // check: an attacker who only knows the slug (not the provider secret)
      // must not be able to burn a signed source's shared window with junk
      // requests. A missing signature should 401 without ever recording a hit.
      const stripeSource = { ...sampleSource, provider: "stripe" };
      stubSourceOnly([stripeSource]);
      mockRecordWebhookHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 5,
      });
      mockReadRawBody.mockResolvedValue(
        JSON.stringify({ type: "charge.succeeded" }),
      );
      mockGetHeader.mockReturnValue(undefined);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockRecordWebhookHit).not.toHaveBeenCalled();
    });

    it("still throttles a no-provider source, whose signature check is a no-op", async () => {
      stubSourceOnly([sampleSource]);
      mockRecordWebhookHit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 5,
      });
      mockReadRawBody.mockResolvedValue(JSON.stringify({ title: "T" }));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 429,
      });
      expect(mockRecordWebhookHit).toHaveBeenCalledWith(SOURCE_UUID);
    });
  });
});
