import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { sources } from "../../../db/schema";
import type { ApiRequest } from "../../../types/api.types";
import { requireScope, requireUser } from "../../../utils/auth";
import { ApiError, apiErrorHandler } from "../../../utils/errors";
import {
  computeProviderSecretPlan,
  normalizeSuppliedSecret,
  validateProviderSecretOrThrow,
} from "../../../utils/providerSecret";
import {
  sourceSerializer,
  type SourceApiResponse,
} from "../../../utils/response";
import {
  isKnownProvider,
  KNOWN_PROVIDERS,
  normalizeProvider,
} from "../../../utils/signatureVerifier";
import { sourceNotFoundError } from "../../../utils/sourceErrors";
import { invalidUuidError, isValidUuid } from "../../../utils/uuid";

type RotateSecretAttributes = {
  // Only supplied for manual-secret providers (Stripe): the caller pastes the
  // new signing secret Stripe issued. Generated providers ignore it and mint a
  // fresh secret instead.
  providerSecret?: string | null;
};

type RotateSecretBody = ApiRequest & {
  data?: {
    attributes?: RotateSecretAttributes;
  };
};

function noRotatableSecretError(): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail:
          "This source has no provider set, so it has no secret to rotate. Only sources with a provider (stripe, github, zapier, shortcuts) have a rotatable secret.",
      },
    ],
    422,
  );
}

function unverifiableProviderError(): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: `This source's provider cannot be verified by markpost, so it has no rotatable secret. Provider must be one of: ${KNOWN_PROVIDERS.join(", ")}.`,
      },
    ],
    422,
  );
}

function rotationConflictError(): ApiError {
  return new ApiError(
    [
      {
        status: "409",
        title: "Conflict",
        detail:
          "The source secret changed during this request (likely a concurrent rotation). Try again.",
      },
    ],
    409,
  );
}

async function findUserSource(userId: string, sourceUuid: string) {
  const db = getDb();

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.uuid, sourceUuid)))
    .limit(1);

  return source ?? null;
}

// Optimistic concurrency: the UPDATE only matches when the row still holds the
// secret we read a moment ago. If two rotations race, only the first commits
// and returns a row; the loser matches zero rows, so we never reveal a secret
// that was never stored (reveal-once makes that failure silent and permanent).
async function rotateUserSourceSecret(
  userId: string,
  sourceUuid: string,
  previousSecret: string | null,
  storedSecret: string | null,
) {
  const db = getDb();

  const previousSecretMatches =
    previousSecret === null
      ? isNull(sources.providerSecret)
      : eq(sources.providerSecret, previousSecret);

  const [updated] = await db
    .update(sources)
    .set({ providerSecret: storedSecret })
    .where(
      and(
        eq(sources.userId, userId),
        eq(sources.uuid, sourceUuid),
        previousSecretMatches,
      ),
    )
    .returning();

  return updated ?? null;
}

export default defineEventHandler(async (event): Promise<SourceApiResponse> => {
  try {
    const userId = requireUser(event);
    requireScope(event, "sources:write");
    const sourceUuid = getRouterParam(event, "uuid");

    if (!isValidUuid(sourceUuid)) {
      throw invalidUuidError();
    }

    const body = (await readBody(event)) as RotateSecretBody;
    // null/omitted both mean "not supplied" — a client posting a cached
    // source's attributes back sends providerSecret: null, and that is the
    // intent for every generated provider (and yields Stripe's accurate
    // "required" error rather than a misleading "must be a string").
    const suppliedSecret = normalizeSuppliedSecret(
      body?.data?.attributes?.providerSecret,
    );

    const existing = await findUserSource(userId, sourceUuid);

    if (!existing) {
      throw sourceNotFoundError();
    }

    const provider = normalizeProvider(existing.provider);

    if (!provider) {
      throw noRotatableSecretError();
    }

    if (!isKnownProvider(provider)) {
      throw unverifiableProviderError();
    }

    validateProviderSecretOrThrow(provider, suppliedSecret);

    const { storedSecret, revealSecret } = computeProviderSecretPlan(
      provider,
      suppliedSecret,
    );

    // KNOWN_PROVIDERS is exactly the union of computeProviderSecretPlan's two
    // branches, so a null here can only mean a provider was added to
    // KNOWN_PROVIDERS without a plan — a server bug, not a client error. Fail
    // loud (logged + 500 via apiErrorHandler) rather than 422-ing the caller.
    if (!storedSecret) {
      throw new Error(
        `computeProviderSecretPlan returned no secret for known provider "${provider}"`,
      );
    }

    const updated = await rotateUserSourceSecret(
      userId,
      sourceUuid,
      existing.providerSecret,
      storedSecret,
    );

    if (!updated) {
      // Zero rows matched: either the row was deleted between our read and
      // write (404), or a concurrent rotation moved the secret out from under
      // the optimistic guard (409). Re-read to report the accurate one.
      const stillExists = await findUserSource(userId, sourceUuid);
      throw stillExists ? rotationConflictError() : sourceNotFoundError();
    }

    // Reveal the freshly-generated secret exactly once, mirroring source
    // creation — the endpointSlug is untouched, so the provider's existing
    // webhook URL keeps working and only the secret needs re-pasting.
    return {
      data: sourceSerializer(
        { ...updated, providerSecret: revealSecret },
        { revealProviderSecret: true },
      ),
    };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
