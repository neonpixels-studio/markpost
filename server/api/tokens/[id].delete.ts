import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { apiTokens } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { isValidUuid } from "../../utils/uuid";
import type { ApiResponse } from "../../types/api.types";

type RevokeTokenApiResponse = ApiResponse<null>;

function invalidIdError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Invalid Parameter",
        detail: "The id parameter is missing or malformed.",
        source: { parameter: "id" },
      },
    ],
    400,
  );
}

function notFoundError(): ApiError {
  return new ApiError(
    [{ status: "404", title: "Not Found", detail: "Token not found" }],
    404,
  );
}

async function revokeToken(
  db: ReturnType<typeof getDb>,
  userId: string,
  tokenId: string,
): Promise<void> {
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  if (!revoked) {
    throw notFoundError();
  }
}

export default defineEventHandler(
  async (event): Promise<RevokeTokenApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "tokens:write");
      const tokenId = getRouterParam(event, "id");

      if (!isValidUuid(tokenId)) {
        throw invalidIdError();
      }

      await revokeToken(getDb(), userId, tokenId);

      return { data: null };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
