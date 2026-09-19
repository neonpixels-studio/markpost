import { and, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb } from "../../../db";
import { sources } from "../../../db/schema";
import type { ApiRequest, ApiResponse } from "../../../types/api.types";
import { requireScope, requireUser } from "../../../utils/auth";
import { ApiError, apiErrorHandler } from "../../../utils/errors";
import { applyFieldMapping, isPlainObject } from "../../../utils/fieldMapper";
import { parseWebhookPayload } from "../../../utils/markdown";
import {
  buildGithubSignatureHeader,
  buildStripeSignatureHeader,
  GITHUB_PROVIDER,
  GITHUB_SIGNATURE_HEADER,
  isHashedStorageProvider,
  normalizeProvider,
  STRIPE_PROVIDER,
  STRIPE_SIGNATURE_HEADER,
  verifyProviderSignature,
} from "../../../utils/signatureVerifier";
import { fetchFilenameTemplate } from "../../../utils/userSettings";
import { sourceNotFoundError } from "../../../utils/sourceErrors";
import { invalidUuidError, isValidUuid } from "../../../utils/uuid";
import { assertBodyWithinLimit } from "../../../utils/webhookBodyLimit";
import { isSourceTestable } from "#shared/utils/sourceTypes";
import { buildTestEventSamplePayload } from "#shared/utils/testEventSamplePayload";

type SourceRow = {
  uuid: string;
  userId: string;
  type: string;
  name: string;
  provider: string | null;
  providerSecret: string | null;
  fieldMapping: unknown;
};

type TestEventRequestAttributes = {
  // A caller-supplied sample payload, so a source with a custom field mapping
  // can be tested against a shape that actually matches its own dot paths
  // instead of only the generic default (see buildSamplePayload). Omit to use
  // the default.
  payload?: unknown;
};

type TestEventRequestBody = ApiRequest & {
  data?: { attributes?: TestEventRequestAttributes };
};

type SignatureCheckStatus =
  "not_required" | "verified" | "failed" | "not_verifiable";

type SignatureCheckResult = {
  status: SignatureCheckStatus;
  message: string;
};

type FieldMappingPreview = {
  title: string;
  content: string;
  tags: string[];
  frontmatter: unknown;
  // Illustrative only: this does not run the real ingest path's
  // ensureUniqueFilePath collision resolution (server/utils/filePathCollision.ts),
  // so a real delivery landing on this exact path may be re-suffixed.
  filePath: string;
};

type TestEventAttributes = {
  provider: string | null;
  payload: Record<string, unknown>;
  signatureCheck: SignatureCheckResult;
  fieldMapping: FieldMappingPreview;
};

type TestEventResource = {
  type: "sourceTestEvents";
  id: string;
  attributes: TestEventAttributes;
};

type TestEventApiResponse = ApiResponse<TestEventResource>;

function invalidPayloadError(): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: "payload must be a JSON object.",
        source: { pointer: "/data/attributes/payload" },
      },
    ],
    422,
  );
}

function malformedRequestBodyError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Bad Request",
        detail: "Request body must be valid JSON.",
      },
    ],
    400,
  );
}

function notTestableSourceError(): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail:
          "This source does not ingest via the JSON webhook path, so there is no signature or field-mapping behavior to test here.",
      },
    ],
    422,
  );
}

async function findUserSource(
  userId: string,
  sourceUuid: string,
): Promise<SourceRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      uuid: sources.uuid,
      userId: sources.userId,
      type: sources.type,
      name: sources.name,
      provider: sources.provider,
      providerSecret: sources.providerSecret,
      fieldMapping: sources.fieldMapping,
    })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.uuid, sourceUuid)))
    .limit(1);

  return row ?? null;
}

// Reads and parses the request body manually (readRawBody, not readBody)
// so the size cap below runs against the raw bytes BEFORE they are parsed —
// mirroring server/api/hooks/[slug].post.ts's own ordering (Content-Length
// pre-check, then assertBodyWithinLimit right after readRawBody, before any
// JSON.parse). readBody would parse an arbitrarily large body first and only
// let a cap on the re-serialized payload catch it afterwards, by which point
// the expensive part (reading + parsing) already happened on an
// authenticated endpoint with no size ceiling of its own.
async function parseRequestBody(
  event: H3Event,
): Promise<TestEventRequestBody | undefined> {
  const rawRequestBody = (await readRawBody(event)) ?? "";
  assertBodyWithinLimit(rawRequestBody);

  if (!rawRequestBody) {
    return undefined;
  }

  try {
    return JSON.parse(rawRequestBody) as TestEventRequestBody;
  } catch {
    throw malformedRequestBodyError();
  }
}

function resolveTestPayload(
  body: TestEventRequestBody | undefined,
): Record<string, unknown> {
  const provided = body?.data?.attributes?.payload;

  // The default (buildTestEventSamplePayload) is a generic top-level-keys
  // payload that maps 1:1 through the raw (no fieldMapping configured) ingest
  // path — see applyFieldMapping's fallback to buildRawWebhookPayload. A
  // source with a custom field mapping should pass its own sample payload
  // instead (matching its own dot paths) via this attribute.
  if (provided === undefined) {
    return buildTestEventSamplePayload();
  }

  if (!isPlainObject(provided)) {
    throw invalidPayloadError();
  }

  return provided;
}

function buildSignatureHeaders(
  provider: string,
  rawBody: string,
  secret: string | null,
): Record<string, string | undefined> {
  if (!secret) {
    return {};
  }

  if (provider === GITHUB_PROVIDER) {
    return {
      [GITHUB_SIGNATURE_HEADER]: buildGithubSignatureHeader(rawBody, secret),
    };
  }

  if (provider === STRIPE_PROVIDER) {
    return {
      [STRIPE_SIGNATURE_HEADER]: buildStripeSignatureHeader(rawBody, secret),
    };
  }

  return {};
}

// Mirrors the exact dispatch verifyProviderSignature uses at real delivery
// time (server/api/hooks/[slug].post.ts), so this exercises the same code
// path a live webhook goes through. Two branches are handled before ever
// calling it:
// - No provider: slug-only sources need no signature, so there's nothing to
//   exercise — report that plainly rather than a vacuous "verified".
// - Shared-secret providers (zapier/shortcuts): only a SHA-256 hash of the
//   secret is ever persisted (server/db/schema.ts) — the plaintext needed to
//   build a valid x-markpost-secret header is gone the moment it was
//   generated, so this can never be re-signed from the server. Reported as
//   "not_verifiable" (not "failed") since that's a storage design choice, not
//   a misconfiguration.
// For github/stripe, note what "verified" can and cannot prove: this signs
// the test payload with the source's OWN stored secret and then verifies that
// same signature (see buildSignatureHeaders below), so a pass only shows the
// secret is present, well-formed, and accepted by this app's HMAC logic — it
// cannot show the provider's own copy of the secret matches (see the
// "verified" branch's message for the caveat surfaced to the user).
function buildSignatureCheck(
  provider: string,
  rawBody: string,
  secret: string | null,
): SignatureCheckResult {
  if (provider === "") {
    return {
      status: "not_required",
      message:
        "No provider is configured for this source — deliveries are authenticated by the endpoint's secret URL slug alone.",
    };
  }

  // isHashedStorageProvider (not isSharedSecretProvider): the reason this
  // can't be re-signed is a STORAGE fact (only a hash is persisted), not an
  // auth-scheme fact (shared-secret vs HMAC). The two sets happen to coincide
  // today, but branching on the storage predicate means a future
  // shared-secret provider that stores plaintext would correctly fall through
  // to the HMAC/verify path below instead of being wrongly told it can't be
  // checked.
  if (isHashedStorageProvider(provider)) {
    return {
      status: "not_verifiable",
      message: `${provider} authenticates with a shared secret that markpost stores only as a one-way hash, so it can't be re-signed from the server to test here. Copy the current secret from this source's card into ${provider} to confirm delivery for real. Field mapping below was still tested against your sample payload.`,
    };
  }

  const headers = buildSignatureHeaders(provider, rawBody, secret);
  const result = verifyProviderSignature({
    provider,
    headers,
    rawBody,
    secret,
  });

  if (result.ok) {
    return {
      status: "verified",
      // Deliberately not phrased as "delivery confirmed": this signs the test
      // payload with the source's OWN stored secret and then verifies that
      // same signature, so it can only ever prove the secret is present,
      // well-formed, and accepted by this app's own HMAC logic — it cannot
      // prove the provider's copy of the secret matches (a typo pasted into
      // Stripe/GitHub's own webhook settings would still 401 every real
      // delivery while this reports "verified").
      message: `This source's stored secret produced a valid ${provider} signature that markpost's own verification logic accepted. This confirms the secret is present and usable here — it cannot confirm ${provider} itself has the exact same value configured. If real deliveries still fail, re-copy the current secret from this source into ${provider}.`,
    };
  }

  return { status: "failed", message: result.reason };
}

async function buildFieldMappingPreview(
  source: SourceRow,
  payload: Record<string, unknown>,
): Promise<FieldMappingPreview> {
  const webhookPayload = applyFieldMapping(
    payload,
    source.fieldMapping,
    source.name,
  );
  const filenameTemplate = await fetchFilenameTemplate(source.userId);
  const parsed = parseWebhookPayload(webhookPayload, { filenameTemplate });

  return {
    title: parsed.title,
    content: parsed.body,
    tags: parsed.tags,
    frontmatter: parsed.frontmatter,
    filePath: parsed.filePath,
  };
}

export default defineEventHandler(
  async (event): Promise<TestEventApiResponse> => {
    try {
      const userId = requireUser(event);
      // sources:write, not sources:read: this signs a payload with the
      // source's stored providerSecret and reports whether it verifies, so a
      // read-only token must not be able to probe secret health. A
      // sources:write token can already rotate that secret, so gating here
      // grants it nothing it didn't have.
      requireScope(event, "sources:write");
      const sourceUuid = getRouterParam(event, "uuid");

      if (!isValidUuid(sourceUuid)) {
        throw invalidUuidError();
      }

      const source = await findUserSource(userId, sourceUuid);

      if (!source) {
        throw sourceNotFoundError();
      }

      if (!isSourceTestable(source.type)) {
        throw notTestableSourceError();
      }

      // parseRequestBody enforces the same size cap a real delivery is held
      // to (webhookBodyLimit.ts) against the raw request bytes BEFORE
      // parsing — see its own comment for why that ordering matters.
      const body = await parseRequestBody(event);
      const payload = resolveTestPayload(body);
      const rawBody = JSON.stringify(payload);
      const provider = normalizeProvider(source.provider);

      const signatureCheck = buildSignatureCheck(
        provider,
        rawBody,
        source.providerSecret,
      );
      const fieldMapping = await buildFieldMappingPreview(source, payload);

      return {
        data: {
          type: "sourceTestEvents",
          id: source.uuid,
          attributes: {
            provider: source.provider,
            payload,
            signatureCheck,
            fieldMapping,
          },
        },
      };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
