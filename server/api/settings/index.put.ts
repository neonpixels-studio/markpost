import { getDb } from "../../db";
import { userSettings } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import { assertValidFilenameTemplate } from "../../utils/filenameTemplate";
import { assertValidVaultDir } from "../../utils/vaultDir";
import {
  CONFLICT_STRATEGIES,
  THEMES,
  userSettingsSerializer,
  type UserSettingsApiResponse,
} from "../../utils/response";
import { apiValidate, type AttributeRule } from "../../utils/validate";

type UpdateSettingsAttributes = {
  vaultDir?: string;
  filenameTemplate?: string;
  autoSync?: boolean;
  autoDelete?: boolean;
  frontmatter?: boolean;
  conflictStrategy?: string;
  theme?: string;
  accentColor?: string;
};

type UpdateSettingsBody = {
  data?: {
    type?: string;
    attributes?: UpdateSettingsAttributes;
  };
};

const VALIDATION_RULES: AttributeRule[] = [
  { key: "vaultDir", type: "string", optional: true },
  { key: "filenameTemplate", type: "string", optional: true },
  { key: "autoSync", type: "boolean", optional: true },
  { key: "autoDelete", type: "boolean", optional: true },
  { key: "frontmatter", type: "boolean", optional: true },
  {
    key: "conflictStrategy",
    type: "string",
    optional: true,
    enum: CONFLICT_STRATEGIES,
  },
  { key: "theme", type: "string", optional: true, enum: THEMES },
  { key: "accentColor", type: "string", optional: true },
];

const ALLOWED_ATTRIBUTE_KEYS: (keyof UpdateSettingsAttributes)[] = [
  "vaultDir",
  "filenameTemplate",
  "autoSync",
  "autoDelete",
  "frontmatter",
  "conflictStrategy",
  "theme",
  "accentColor",
];

function isAttributePresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// apiValidate only type-checks vaultDir/filenameTemplate. These two also carry
// path-safety and collision rules (a placeholder-free template collapses every
// record onto one file_path), so run their dedicated validators here — each
// throws a 422 on a bad value. An empty value is a no-op that preserves the
// column default, so only validate a value that is actually present.
function assertValidPathAttributes(attributes: UpdateSettingsAttributes): void {
  if (isAttributePresent(attributes.filenameTemplate)) {
    assertValidFilenameTemplate(attributes.filenameTemplate);
  }
  if (isAttributePresent(attributes.vaultDir)) {
    assertValidVaultDir(attributes.vaultDir);
  }
}

function pickAllowedAttributes(
  attributes: UpdateSettingsAttributes,
): UpdateSettingsAttributes {
  const result: UpdateSettingsAttributes = {};
  for (const key of ALLOWED_ATTRIBUTE_KEYS) {
    if (isAttributePresent(attributes[key])) {
      result[key] = attributes[key] as never;
    }
  }
  return result;
}

type Database = ReturnType<typeof getDb>;

async function upsertUserSettings(
  database: Database,
  userId: string,
  attributes: UpdateSettingsAttributes,
) {
  const safeAttributes = pickAllowedAttributes(attributes);

  const [updated] = await database
    .insert(userSettings)
    .values({ userId, ...safeAttributes })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...safeAttributes, updatedAt: new Date() },
    })
    .returning();

  return updated;
}

export default defineEventHandler(
  async (event): Promise<UserSettingsApiResponse> => {
    try {
      const userId = requireUser(event);
      const body = (await readBody(event)) as UpdateSettingsBody;

      apiValidate(body as ApiRequest, VALIDATION_RULES);

      const attributes =
        (body.data?.attributes as UpdateSettingsAttributes) ?? {};
      assertValidPathAttributes(attributes);
      const settings = await upsertUserSettings(getDb(), userId, attributes);

      return { data: userSettingsSerializer(settings) };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);

export { upsertUserSettings };
