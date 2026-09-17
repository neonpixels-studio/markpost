import { count, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";
import type { SubscriptionPlan, SubscriptionStatus } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import { countRecordsCreatedThisMonth } from "../../utils/recordUsage";
import {
  calculateTrialProgress,
  findSubscriptionByUserId,
  type SubscriptionRow,
} from "../../utils/billing";

type BillingUsage = {
  recordsCreatedThisMonth: number;
  connectedSourceCount: number;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  trialPercentElapsed: number | null;
};

type BillingUsageApiResponse = {
  data: BillingUsage;
};

const DEFAULT_PLAN: SubscriptionPlan = "hobby";
const DEFAULT_STATUS: SubscriptionStatus = "active";

async function fetchConnectedSourceCount(userId: string): Promise<number> {
  const db = getDb();

  const rows = await db
    .select({ total: count() })
    .from(sources)
    .where(eq(sources.userId, userId));

  return Number(rows[0]?.total ?? 0);
}

type SubscriptionUsageFields = Pick<
  BillingUsage,
  "plan" | "status" | "trialEndsAt" | "trialDaysLeft" | "trialPercentElapsed"
>;

function resolveSubscriptionUsage(
  subscription: SubscriptionRow | null,
): SubscriptionUsageFields {
  if (!subscription) {
    return {
      plan: DEFAULT_PLAN,
      status: DEFAULT_STATUS,
      trialEndsAt: null,
      trialDaysLeft: null,
      trialPercentElapsed: null,
    };
  }

  const isTrialing =
    subscription.status === "trialing" && subscription.trialEndsAt !== null;
  const trialProgress = isTrialing
    ? calculateTrialProgress(subscription.trialEndsAt as Date)
    : null;

  return {
    plan: subscription.plan as SubscriptionPlan,
    status: subscription.status as SubscriptionStatus,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft: trialProgress?.daysLeft ?? null,
    trialPercentElapsed: trialProgress?.percentElapsed ?? null,
  };
}

export default defineEventHandler(
  async (event): Promise<BillingUsageApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "billing:read");

      const [recordsCreatedThisMonth, connectedSourceCount, subscription] =
        await Promise.all([
          countRecordsCreatedThisMonth(userId),
          fetchConnectedSourceCount(userId),
          findSubscriptionByUserId(userId),
        ]);

      return {
        data: {
          recordsCreatedThisMonth,
          connectedSourceCount,
          ...resolveSubscriptionUsage(subscription),
        },
      };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
