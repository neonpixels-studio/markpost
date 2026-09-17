import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import { findSubscriptionByUserId } from "../../utils/billing";
import { buildAppUrl } from "../../utils/appUrl";
import { createCustomerPortalSession } from "../../services/stripe";

export default defineEventHandler(async (event) => {
  try {
    const userId = requireUser(event);
    requireScope(event, "billing:write");
    const subscription = await findSubscriptionByUserId(userId);

    if (!subscription?.stripeCustomerId) {
      throw new ApiError(
        [
          {
            status: "404",
            title: "Not Found",
            detail: "No active subscription found for this user.",
          },
        ],
        404,
      );
    }

    const appUrl = buildAppUrl();

    const portalSession = await createCustomerPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl: `${appUrl}/settings`,
    });

    return { data: { url: portalSession.url } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
