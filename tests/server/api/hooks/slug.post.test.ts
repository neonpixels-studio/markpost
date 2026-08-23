import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import {
  buildValidStripeHeader,
  buildValidGithubHeader,
  stubFailingUpdate,
  spyConsoleError,
} from "../../helpers";
import { ApiError } from "../../../../server/utils/errors";
import {
  CONTENT_LENGTH_HEADER,
  MAX_WEBHOOK_BODY_BYTES,
} from "../../../../server/utils/webhookBodyLimit";
import { hashSharedSecret } from "../../../../server/utils/signatureVerifier";
import { records } from "../../../../server/db/schema";
import { MAX_FILE_PATH_INSERT_ATTEMPTS } from "../../../../server/utils/filePathCollision";
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
// Resolves to filePath "2026-01-01-hello.md" under the default template — the
// shared body for the file_path collision tests.
const SAMPLE_RAW_BODY = JSON.stringify({
  title: "Hello",
  content: "C",
  created: "2026-01-01T00:00:00.000Z",
});

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
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoNothing, returning };
}

// Every insert attempt rejects with `error`. Returns the `returning` spy so a
// test can assert how many attempts ran before the handler gave up.
function stubInsertRejecting(error: unknown) {
  const returning = vi.fn(() => Promise.reject(error));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  insertMock.mockReturnValue({ values });
  return returning;
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

    it("retries with a suffixed path instead of 500ing when a concurrent insert claimed the path (23505)", async () => {
      const rawBody = JSON.stringify({
        title: "Hello",
        content: "C",
        created: "2026-01-01T00:00:00.000Z",
      });

      // First lookup sees nothing taken, so the clean path is inserted; the
      // insert loses the race to a concurrent writer (23505). The retry's
      // collision lookup now sees the winning row and suffixes.
      stubSourceAndSettings([sampleSource]);
      const retryCollisionWhere = vi.fn(() =>
        Promise.resolve([{ filePath: "2026-01-01-hello.md" }]),
      );
      const retryCollisionFrom = vi.fn(() => ({ where: retryCollisionWhere }));
      selectMock.mockReturnValueOnce({ from: retryCollisionFrom });

      const uniqueViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_user_id_file_path_lower_unique",
      });
      const returning = vi
        .fn()
        .mockRejectedValueOnce(uniqueViolation)
        .mockResolvedValueOnce([sampleRecord]);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      insertMock.mockReturnValue({ values });
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(values).toHaveBeenCalledTimes(2);
      const secondInsert = (
        values.mock.calls[1] as [Record<string, unknown>]
      )[0];
      expect(secondInsert.filePath).toBe("2026-01-01-hello-2.md");
    });

    it("resolves the retry off the original stem (…-3, not …-2-2) when the path was already suffixed", async () => {
      const rawBody = JSON.stringify({
        title: "Hello",
        content: "C",
        created: "2026-01-01T00:00:00.000Z",
      });

      // Request-time collision: the pre-insert lookup sees "2026-01-01-hello.md",
      // so the first insert uses the already-suffixed "…-hello-2.md". It then
      // loses the race (another writer took "…-hello-2.md" too). The retry must
      // re-resolve from the ORIGINAL "…-hello.md", whose prefix sees both taken
      // rows, landing on "…-hello-3.md" — never nesting to "…-hello-2-2.md".
      stubSourceAndSettings([sampleSource], DEFAULT_FILENAME_TEMPLATE, [
        { filePath: "2026-01-01-hello.md" },
      ]);
      const retryCollisionWhere = vi.fn(() =>
        Promise.resolve([
          { filePath: "2026-01-01-hello.md" },
          { filePath: "2026-01-01-hello-2.md" },
        ]),
      );
      const retryCollisionFrom = vi.fn(() => ({ where: retryCollisionWhere }));
      selectMock.mockReturnValueOnce({ from: retryCollisionFrom });

      const uniqueViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_user_id_file_path_lower_unique",
      });
      const returning = vi
        .fn()
        .mockRejectedValueOnce(uniqueViolation)
        .mockResolvedValueOnce([sampleRecord]);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      insertMock.mockReturnValue({ values });
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);

      await handler(buildEvent());

      const firstInsert = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      const secondInsert = (
        values.mock.calls[1] as [Record<string, unknown>]
      )[0];
      expect(firstInsert.filePath).toBe("2026-01-01-hello-2.md");
      expect(secondInsert.filePath).toBe("2026-01-01-hello-3.md");
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

    it("returns a non-retryable 409 (not 500) when the filePath retry budget is exhausted", async () => {
      // Every insert loses the file_path race (23505), and each retry's
      // collision lookup shows one more taken suffix so the resolver keeps
      // handing back a genuinely new path until the attempt budget is spent and
      // insertRecordWithUniqueFilePath re-throws the raw 23505. Left unmapped
      // that surfaces as a 500 the provider (Stripe/GitHub) retries, risking a
      // duplicate record; the handler must map it to the create handler's
      // non-retryable 409 instead. Asserting 409 fails the moment the mapping
      // regresses to a bare 500.
      stubSourceAndSettings([sampleSource]);

      // One retry-collision lookup per re-resolution (attempts 0..N-2 re-resolve;
      // the final attempt exhausts the budget without another lookup). Each
      // lookup shows one more taken suffix so the resolver keeps handing back a
      // genuinely new path. Generated from the real budget so bumping
      // MAX_FILE_PATH_INSERT_ATTEMPTS keeps the fixtures in lockstep.
      const takenSuffixSets = Array.from(
        { length: MAX_FILE_PATH_INSERT_ATTEMPTS - 1 },
        (_unused, lookupIndex) => [
          "2026-01-01-hello.md",
          ...Array.from(
            { length: lookupIndex },
            (_unusedSuffix, suffixIndex) =>
              `2026-01-01-hello-${suffixIndex + 2}.md`,
          ),
        ],
      );
      for (const takenPaths of takenSuffixSets) {
        const retryCollisionWhere = vi.fn(() =>
          Promise.resolve(takenPaths.map((filePath) => ({ filePath }))),
        );
        const retryCollisionFrom = vi.fn(() => ({
          where: retryCollisionWhere,
        }));
        selectMock.mockReturnValueOnce({ from: retryCollisionFrom });
      }

      const uniqueViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_user_id_file_path_lower_unique",
      });
      const returning = stubInsertRejecting(uniqueViolation);
      mockReadRawBody.mockResolvedValue(SAMPLE_RAW_BODY);
      const consoleErrorSpy = spyConsoleError();

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 409,
      });
      // Every attempt in the budget was spent before the 409, so the mapping
      // fires on genuine exhaustion — not by short-circuiting the first
      // collision straight to 409 (which would leave these inserts uncalled).
      expect(returning).toHaveBeenCalledTimes(MAX_FILE_PATH_INSERT_ATTEMPTS);
      // Fail loud with actionable context: the swallowed 23505 is logged with
      // the source/delivery/path identifiers, so an operator can trace it.
      // Deleting the console.error regresses this.
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[hooks/ingest]"),
        expect.objectContaining({
          sourceId: SOURCE_UUID,
          userId: USER_ID,
          filePath: "2026-01-01-hello.md",
          error: uniqueViolation,
        }),
      );
      // Webhook senders post a raw provider payload, so the 409 must not carry
      // the create handler's `/data/attributes/filePath` JSON:API pointer for a
      // field the sender never set.
      const errorArgs = mockCreateError.mock.calls.at(-1)?.[0] as {
        data: { errors: Array<{ source?: unknown }> };
      };
      expect(errorArgs.data.errors[0].source).toBeUndefined();
    });

    it("maps a single-attempt unresolvable collision to the same 409", async () => {
      // The other re-throw branch: the first insert 23505s and the resolver can
      // only hand back the path that just failed (nothing new is visible yet), so
      // insertRecordWithUniqueFilePath re-throws on attempt 0 without exhausting
      // the budget. That still maps to the 409, not a 500. The pre-insert lookup
      // and the retry lookup both see nothing taken, so the resolver returns the
      // unchanged "…hello.md" — equal to the failed path — and gives up.
      stubSourceAndSettings([sampleSource]);
      const retryCollisionWhere = vi.fn(() => Promise.resolve([]));
      const retryCollisionFrom = vi.fn(() => ({ where: retryCollisionWhere }));
      selectMock.mockReturnValueOnce({ from: retryCollisionFrom });

      const uniqueViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_user_id_file_path_lower_unique",
      });
      const returning = stubInsertRejecting(uniqueViolation);
      mockReadRawBody.mockResolvedValue(SAMPLE_RAW_BODY);
      spyConsoleError();

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 409,
      });
      // Gave up on attempt 0 — a single insert, no budget-exhausting retry loop.
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it("re-throws a non-file-path insert failure as a 500 (mapping is scoped to 23505)", async () => {
      // A DB failure that is NOT the file_path unique violation (e.g. a dropped
      // connection) must propagate untouched to the generic 500 handler, never
      // get masked as a 409. Guards the `isFilePathUniqueViolation` branch so
      // blanket-mapping every error to 409 fails here.
      stubSourceAndSettings([sampleSource]);
      const connectionError = Object.assign(
        new Error("connection terminated unexpectedly"),
        { code: "57P01" },
      );
      const returning = stubInsertRejecting(connectionError);
      mockReadRawBody.mockResolvedValue(SAMPLE_RAW_BODY);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 500,
      });
      // Not retried as a file_path collision — one insert attempt, then propagate.
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it("re-throws a 23505 on a different unique index as a 500, not a 409", async () => {
      // isFilePathUniqueViolation matches on BOTH code and the file_path
      // constraint name. A 23505 on a different unique index (e.g. the
      // source_id/delivery_id dedup index) is not a file_path collision, so it
      // must surface as a 500 — never get mislabeled a file-path 409. Guards
      // against isFilePathUniqueViolation regressing to a code-only check.
      stubSourceAndSettings([sampleSource]);
      const otherViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_source_id_delivery_id_unique",
      });
      const returning = stubInsertRejecting(otherViolation);
      mockReadRawBody.mockResolvedValue(SAMPLE_RAW_BODY);
      spyConsoleError();

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 500,
      });
      // Not treated as a file_path collision — no retry loop.
      expect(returning).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalid body — non-object payload", () => {
    // A non-JSON object body (form-encoded, plain text, JSON scalar/array/null,
    // or empty) must fail loud with a 400 whose message points the operator at
    // the fix, and must NOT create a record or bump source stats. Asserting the
    // message keeps the test honest: blanking NON_OBJECT_BODY_DETAIL fails it.
    // sampleSource has provider `null`, so the GitHub `payload=` unwrap never
    // applies — a bare form body is rejected like any other non-object.
    async function expectNonObjectBodyRejected(rawBody: string): Promise<void> {
      stubSourceOnly([sampleSource]);
      const { values } = stubInsertRecord(sampleRecord);
      mockReadRawBody.mockResolvedValue(rawBody);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(values).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      // Ordering guard: the body is validated after the throttle (so junk
      // deliveries still count against the window) but before the expensive
      // plan-limit COUNT (which a doomed delivery must never pay for).
      expect(mockRecordWebhookHit).toHaveBeenCalledWith(SOURCE_UUID);
      expect(mockAssertWithinRecordLimit).not.toHaveBeenCalled();
      expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        202,
      );
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 400,
        data: {
          errors: [
            expect.objectContaining({
              status: "400",
              title: "Bad Request",
              detail: expect.stringContaining("application/json"),
            }),
          ],
        },
      });
    }

    it("rejects a form-encoded body from a non-GitHub source with 400", async () => {
      await expectNonObjectBodyRejected("title=hello&body=world");
    });

    it("rejects a non-GitHub source's `payload=` form body with 400", async () => {
      const githubJson = JSON.stringify({ title: "Push" });
      await expectNonObjectBodyRejected(
        `payload=${encodeURIComponent(githubJson)}`,
      );
    });

    it("rejects a plain-text body with 400", async () => {
      await expectNonObjectBodyRejected("not-json");
    });

    it("rejects a valid-JSON non-object body (null) with 400", async () => {
      await expectNonObjectBodyRejected("null");
    });

    it("rejects a valid-JSON array body with 400", async () => {
      await expectNonObjectBodyRejected(JSON.stringify([1, 2, 3]));
    });

    it("rejects an empty body with 400", async () => {
      await expectNonObjectBodyRejected("");
    });

    // The contract is the object shape, not its contents: an empty JSON object is
    // a valid object and is ingested (field mapping / source name may still fill
    // the title). Pinned so this boundary is intentional, not an accident.
    it("accepts an empty JSON object and returns 202", async () => {
      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue("{}");

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

    // Signature verification must run before body validation: an unsigned caller
    // sending garbage should see 401 (auth failure), never 400 (which would leak
    // that the slug exists and reveal how the body is parsed). Guards the ordering
    // against a future refactor hoisting the parse above checkSignature.
    it("returns 401 (not 400) for an unsigned request with a non-JSON body", async () => {
      stubSourceOnly([stripeSource]);
      mockReadRawBody.mockResolvedValue("not-json");
      mockGetHeader.mockReturnValue(undefined);

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

    // GitHub's default content type is form-encoded: the JSON is URL-encoded under
    // a `payload` field (spaces as `+`), and the HMAC is over that raw form body.
    // Signature verification and payload unwrap must compose end to end.
    it("returns 202 for a signed form-encoded GitHub delivery", async () => {
      const formBody = new URLSearchParams({
        payload: JSON.stringify({ title: "Push", content: "to main" }),
      }).toString();

      stubSourceAndSettings([githubSource]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(formBody);
      stubGithubHeader(formBody, GITHUB_SECRET);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.title).toBe("Push");
    });

    it("returns 400 for a signed GitHub form body whose payload is not a JSON object", async () => {
      const formBody = "payload=null";

      stubSourceOnly([githubSource]);
      stubInsertRecord(sampleRecord);
      mockReadRawBody.mockResolvedValue(formBody);
      stubGithubHeader(formBody, GITHUB_SECRET);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a signed GitHub body with an empty payload field", async () => {
      const formBody = "payload=";

      stubSourceOnly([githubSource]);
      stubInsertRecord(sampleRecord);
      mockReadRawBody.mockResolvedValue(formBody);
      stubGithubHeader(formBody, GITHUB_SECRET);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(insertMock).not.toHaveBeenCalled();
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

    // The GitHub `payload=` form unwrap is gated to GitHub sources: a verified
    // non-GitHub provider (here Zapier) must still reject a form-encoded body
    // rather than unwrapping a `payload` field, so this shape is not a smuggling
    // path around the JSON-object contract for other providers.
    it("returns 400 for a signed Zapier delivery with a form-encoded `payload` body", async () => {
      const source = {
        ...sampleSource,
        provider: "zapier",
        providerSecret: STORED_SECRET_HASH,
      };
      const formBody = `payload=${encodeURIComponent(JSON.stringify({ title: "T" }))}`;

      stubSourceOnly([source]);
      stubInsertRecord(sampleRecord);
      mockReadRawBody.mockResolvedValue(formBody);
      stubSharedSecretHeader(SHARED_SECRET);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });
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
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
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

  describe("payload size limit", () => {
    function stubContentLengthHeader(value: string): void {
      mockGetHeader.mockImplementation((_event: unknown, name: string) =>
        name === CONTENT_LENGTH_HEADER ? value : undefined,
      );
    }

    it("returns 413 by Content-Length before the source lookup or reading the body", async () => {
      stubContentLengthHeader(String(MAX_WEBHOOK_BODY_BYTES + 1));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 413,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 413,
        data: {
          errors: [
            {
              status: "413",
              title: "Payload Too Large",
              detail: expect.stringContaining(String(MAX_WEBHOOK_BODY_BYTES)),
            },
          ],
        },
      });
      // Rejected on the declared length before doing any work: no source lookup,
      // no body buffering, no throttle budget spent, no record inserted.
      expect(selectMock).not.toHaveBeenCalled();
      expect(mockReadRawBody).not.toHaveBeenCalled();
      expect(mockRecordWebhookHit).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("returns 413 on the actual byte count when Content-Length is absent", async () => {
      stubSourceOnly([sampleSource]);
      mockGetHeader.mockReturnValue(undefined);
      mockReadRawBody.mockResolvedValue("a".repeat(MAX_WEBHOOK_BODY_BYTES + 1));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 413,
      });
      expect(insertMock).not.toHaveBeenCalled();
      expect(mockRecordWebhookHit).not.toHaveBeenCalled();
    });

    it("returns 413 on the real byte count when Content-Length understates the body", async () => {
      stubSourceOnly([sampleSource]);
      stubContentLengthHeader("10");
      mockReadRawBody.mockResolvedValue("a".repeat(MAX_WEBHOOK_BODY_BYTES + 1));

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 413,
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("ingests a body at exactly the byte maximum, passing both checks", async () => {
      const filler = "x".repeat(
        MAX_WEBHOOK_BODY_BYTES - JSON.stringify({ content: "" }).length,
      );
      const rawBody = JSON.stringify({ content: filler });
      expect(Buffer.byteLength(rawBody, "utf8")).toBe(MAX_WEBHOOK_BODY_BYTES);

      stubSourceAndSettings([sampleSource]);
      stubInsertRecord(sampleRecord);
      stubUpdateStats();
      // An honest Content-Length at the exact cap must pass (the guard rejects
      // strictly greater), then the byte check at the same boundary must pass too.
      stubContentLengthHeader(String(MAX_WEBHOOK_BODY_BYTES));
      mockReadRawBody.mockResolvedValue(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
    });
  });

  // Stripe re-sends the same event `id`, and GitHub the same X-GitHub-Delivery,
  // on any non-2xx or timeout. Ingest must be idempotent so those retries return
  // the original record instead of inserting a duplicate.
  describe("provider retry idempotency", () => {
    const GITHUB_SECRET = "github_test_secret";
    const stripeSource = {
      ...sampleSource,
      provider: "stripe",
      providerSecret: STRIPE_SECRET,
    };
    const githubSource = {
      ...sampleSource,
      provider: "github",
      providerSecret: GITHUB_SECRET,
    };

    function stubStripeHeader(rawBody: string): void {
      mockGetHeader.mockImplementation((_event: unknown, name: string) =>
        name === "stripe-signature"
          ? buildValidStripeHeader(rawBody, STRIPE_SECRET)
          : undefined,
      );
    }

    function stubGithubHeaders(rawBody: string, deliveryId: string): void {
      mockGetHeader.mockImplementation((_event: unknown, name: string) => {
        if (name === "x-hub-signature-256") {
          return buildValidGithubHeader(rawBody, GITHUB_SECRET);
        }

        if (name === "x-github-delivery") {
          return deliveryId;
        }

        return undefined;
      });
    }

    function stubSourceThenDelivery(
      sourceRows: unknown[],
      deliveryRows: unknown[],
    ) {
      const sourceChain = makeSelectChain(sourceRows);
      const deliveryChain = makeSelectChain(deliveryRows);
      selectMock
        .mockReturnValueOnce({ from: sourceChain.from })
        .mockReturnValueOnce({ from: deliveryChain.from });
      return { sourceChain, deliveryChain };
    }

    function stubSourceDeliveryAndSettings(
      sourceRows: unknown[],
      deliveryRows: unknown[],
    ) {
      const sourceChain = makeSelectChain(sourceRows);
      const deliveryChain = makeSelectChain(deliveryRows);
      const settingsChain = makeSelectChain([
        { filenameTemplate: DEFAULT_FILENAME_TEMPLATE },
      ]);
      const collisionChain = makeWhereResolvingChain([]);
      selectMock
        .mockReturnValueOnce({ from: sourceChain.from })
        .mockReturnValueOnce({ from: deliveryChain.from })
        .mockReturnValueOnce({ from: settingsChain.from })
        .mockReturnValueOnce({ from: collisionChain.from });
    }

    it("returns the existing record without inserting when a Stripe event id was already ingested", async () => {
      const rawBody = JSON.stringify({
        id: "evt_123",
        type: "charge.succeeded",
      });
      const { deliveryChain } = stubSourceThenDelivery(
        [stripeSource],
        [{ uuid: sampleRecord.uuid, title: "Charge" }],
      );
      mockReadRawBody.mockResolvedValue(rawBody);
      stubStripeHeader(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      // A retry must not insert again, spend plan-limit budget, or re-emit
      // side effects for a record that already landed.
      expect(insertMock).not.toHaveBeenCalled();
      expect(mockAssertWithinRecordLimit).not.toHaveBeenCalled();
      expect(mockWriteEvent).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      // Cross-tenant guard: the lookup must be scoped by BOTH this source's uuid
      // and the delivery id, never delivery id alone — otherwise a colliding id
      // could return another source's record. (The eq() mock returns
      // {column, value}; and() wraps them under conditions.)
      const whereArg = deliveryChain.where.mock.calls[0]?.[0] as {
        conditions: Array<{ value: unknown }>;
      };
      expect(whereArg.conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: SOURCE_UUID }),
          expect.objectContaining({ value: "evt_123" }),
        ]),
      );
    });

    it("stores the Stripe event id on the inserted record so a later retry is detectable", async () => {
      const rawBody = JSON.stringify({
        id: "evt_456",
        type: "charge.succeeded",
      });
      stubSourceDeliveryAndSettings([stripeSource], []);
      const { values, onConflictDoNothing } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubStripeHeader(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.deliveryId).toBe("evt_456");
      // The conflict arbiter must be the (source_id, delivery_id) unique index,
      // or a re-delivery race would insert a duplicate instead of no-op'ing.
      const conflictArg = onConflictDoNothing.mock.calls[0]?.[0] as {
        target: unknown[];
      };
      expect(conflictArg.target[0]).toBe(records.sourceId);
      expect(conflictArg.target[1]).toBe(records.deliveryId);
    });

    it("returns the existing record without inserting when an X-GitHub-Delivery id was already ingested", async () => {
      const rawBody = JSON.stringify({ title: "Push", content: "to main" });
      stubSourceThenDelivery(
        [githubSource],
        [{ uuid: sampleRecord.uuid, title: "Push" }],
      );
      mockReadRawBody.mockResolvedValue(rawBody);
      stubGithubHeaders(rawBody, "d34db33f-0000-0000-0000-000000000000");

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(insertMock).not.toHaveBeenCalled();
      expect(mockAssertWithinRecordLimit).not.toHaveBeenCalled();
    });

    it("stores the X-GitHub-Delivery id on the inserted record", async () => {
      const rawBody = JSON.stringify({ title: "Push", content: "to main" });
      const deliveryId = "gh-delivery-0001";
      stubSourceDeliveryAndSettings([githubSource], []);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubGithubHeaders(rawBody, deliveryId);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.deliveryId).toBe(deliveryId);
    });

    // A GitHub source whose x-github-delivery header was stripped (proxy/CDN, or
    // a rewriting gateway) has no delivery id, so it must not attempt a dedup
    // lookup — it inserts with deliveryId null and runs side effects normally.
    // This exercises a different select ordering than the slug-only case: a
    // signed provider source that still ends up with no delivery id.
    it("skips the dedup lookup for a GitHub source with no delivery header", async () => {
      const rawBody = JSON.stringify({ title: "Push", content: "to main" });
      stubSourceAndSettings([githubSource]);
      const { values } = stubInsertRecord(sampleRecord);
      const { set: updateSet } = stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      // Sign the body but provide NO x-github-delivery header.
      mockGetHeader.mockImplementation((_event: unknown, name: string) =>
        name === "x-hub-signature-256"
          ? buildValidGithubHeader(rawBody, GITHUB_SECRET)
          : undefined,
      );

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.deliveryId).toBeNull();
      // Side effects still run for a genuinely new (non-deduped) record.
      expect(updateSet).toHaveBeenCalled();
      expect(mockWriteEvent).toHaveBeenCalled();
    });

    // A slug-only source has no provider delivery id, so ingest stays as it was:
    // no dedup lookup, and an incidental `id` field in the body is NOT mistaken
    // for a Stripe event id.
    it("does not dedupe a slug-only source and inserts a null delivery id", async () => {
      stubSourceAndSettings([sampleSource]);
      const { values } = stubInsertRecord(sampleRecord);
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(
        JSON.stringify({ id: "evt_should_be_ignored", title: "T" }),
      );

      await handler(buildEvent());

      const insertedValues = (
        values.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(insertedValues.deliveryId).toBeNull();
    });

    // Concurrency backstop: two identical deliveries both miss the pre-check,
    // but the unique index lets only one insert land. The loser gets no row from
    // onConflictDoNothing and must resolve to the winner's record as a dedup hit
    // — a 202 with the canonical uuid, and no duplicate side effects.
    it("treats an insert that loses the unique-index race as a dedup hit", async () => {
      const rawBody = JSON.stringify({
        id: "evt_race",
        type: "charge.succeeded",
      });
      const sourceChain = makeSelectChain([stripeSource]);
      const preCheckChain = makeSelectChain([]);
      const settingsChain = makeSelectChain([
        { filenameTemplate: DEFAULT_FILENAME_TEMPLATE },
      ]);
      const collisionChain = makeWhereResolvingChain([]);
      const raceLookupChain = makeSelectChain([
        { uuid: sampleRecord.uuid, title: "Charge" },
      ]);
      selectMock
        .mockReturnValueOnce({ from: sourceChain.from })
        .mockReturnValueOnce({ from: preCheckChain.from })
        .mockReturnValueOnce({ from: settingsChain.from })
        .mockReturnValueOnce({ from: collisionChain.from })
        .mockReturnValueOnce({ from: raceLookupChain.from });

      const returning = vi.fn(() => Promise.resolve([]));
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      insertMock.mockReturnValue({ values });
      const { set: updateSet } = stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubStripeHeader(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(updateSet).not.toHaveBeenCalled();
      expect(mockWriteEvent).not.toHaveBeenCalled();
    });

    // Fail loud, don't fabricate: if the insert returns no row AND the follow-up
    // delivery lookup also finds nothing (e.g. the winning row was deleted in the
    // gap), there is no record to return — surface a 500 rather than a 202 with
    // an undefined uuid.
    it("throws 500 when a conflicting insert has no recoverable record", async () => {
      const rawBody = JSON.stringify({
        id: "evt_gone",
        type: "charge.succeeded",
      });
      const sourceChain = makeSelectChain([stripeSource]);
      const preCheckChain = makeSelectChain([]);
      const settingsChain = makeSelectChain([
        { filenameTemplate: DEFAULT_FILENAME_TEMPLATE },
      ]);
      const collisionChain = makeWhereResolvingChain([]);
      const raceLookupChain = makeSelectChain([]);
      selectMock
        .mockReturnValueOnce({ from: sourceChain.from })
        .mockReturnValueOnce({ from: preCheckChain.from })
        .mockReturnValueOnce({ from: settingsChain.from })
        .mockReturnValueOnce({ from: collisionChain.from })
        .mockReturnValueOnce({ from: raceLookupChain.from });

      const returning = vi.fn(() => Promise.resolve([]));
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      insertMock.mockReturnValue({ values });
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubStripeHeader(rawBody);

      await expect(handler(buildEvent())).rejects.toMatchObject({
        statusCode: 500,
      });
    });

    // Composition backstop: a delivery-id source can also lose the file_path
    // unique-index race. insertWebhookRecord's onConflictDoNothing only arbitrates
    // (source_id, delivery_id), so a file_path 23505 still throws and is retried
    // by insertRecordWithUniqueFilePath. The retried insert must re-suffix the
    // path AND still carry the delivery id — dropping it would leave a Stripe
    // record with delivery_id NULL, permanently un-dedupable.
    it("retries a file_path collision while preserving the delivery id", async () => {
      const rawBody = JSON.stringify({
        id: "evt_combo",
        title: "Hello",
        content: "C",
        created: "2026-01-01T00:00:00.000Z",
      });
      stubSourceDeliveryAndSettings([stripeSource], []);
      const retryCollisionWhere = vi.fn(() =>
        Promise.resolve([{ filePath: "2026-01-01-hello.md" }]),
      );
      const retryCollisionFrom = vi.fn(() => ({ where: retryCollisionWhere }));
      selectMock.mockReturnValueOnce({ from: retryCollisionFrom });

      const uniqueViolation = Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "records_user_id_file_path_lower_unique",
      });
      const returning = vi
        .fn()
        .mockRejectedValueOnce(uniqueViolation)
        .mockResolvedValueOnce([sampleRecord]);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      insertMock.mockReturnValue({ values });
      stubUpdateStats();
      mockReadRawBody.mockResolvedValue(rawBody);
      stubStripeHeader(rawBody);

      const response = await handler(buildEvent());

      expect202Success(response, mockSetResponseStatus, sampleRecord.uuid);
      expect(values).toHaveBeenCalledTimes(2);
      const secondInsert = (
        values.mock.calls[1] as [Record<string, unknown>]
      )[0];
      expect(secondInsert.filePath).toBe("2026-01-01-hello-2.md");
      expect(secondInsert.deliveryId).toBe("evt_combo");
    });
  });
});
