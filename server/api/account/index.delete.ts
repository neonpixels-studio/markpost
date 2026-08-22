import { reconcileAccountDeletion } from "../../services/accountDeletion";
import { requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";

export default defineEventHandler(
  async (event): Promise<{ meta: { deleted: true } }> => {
    try {
      const userId = requireUser(event);
      await reconcileAccountDeletion(userId);
      return { meta: { deleted: true } };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
