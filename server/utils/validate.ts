import type {
  ApiError as ApiErrorObject,
  ApiRequest,
} from "../types/api.types";
import { ApiError } from "./errors";

export type AttributeRule = {
  key: string;
  message?: string;
  optional?: boolean;
  type?: "string" | "boolean" | "number";
  enum?: readonly string[];
  pattern?: RegExp;
  patternMessage?: string;
};

const VALIDATION_STATUS = "422";
const VALIDATION_TITLE = "Invalid Attribute";

function titleCase(key: string): string {
  if (!key) {
    return key;
  }

  return key.charAt(0).toUpperCase() + key.slice(1);
}

function requiredMessage(key: string): string {
  return `${titleCase(key)} is required`;
}

function typeMessage(key: string, type: string): string {
  return `${titleCase(key)} must be a ${type}`;
}

function enumMessage(key: string, allowed: readonly string[]): string {
  return `${titleCase(key)} must be one of: ${allowed.join(", ")}`;
}

function patternMessage(key: string): string {
  return `${titleCase(key)} has an invalid format`;
}

function buildError(rule: AttributeRule, detail: string): ApiErrorObject {
  return {
    status: VALIDATION_STATUS,
    title: VALIDATION_TITLE,
    detail,
    source: { pointer: `/data/attributes/${rule.key}` },
  };
}

export function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function validatePresence(
  value: unknown,
  rule: AttributeRule,
): ApiErrorObject | null {
  if (!isAbsent(value)) {
    return null;
  }
  if (rule.optional) {
    return null;
  }
  return buildError(rule, rule.message ?? requiredMessage(rule.key));
}

function validateType(
  value: unknown,
  rule: AttributeRule,
): ApiErrorObject | null {
  if (rule.type === "string" && typeof value !== "string") {
    return buildError(rule, typeMessage(rule.key, "string"));
  }
  if (rule.type === "boolean" && typeof value !== "boolean") {
    return buildError(rule, typeMessage(rule.key, "boolean"));
  }
  if (rule.type === "number" && typeof value !== "number") {
    return buildError(rule, typeMessage(rule.key, "number"));
  }
  return null;
}

function validateEnum(
  value: unknown,
  rule: AttributeRule,
): ApiErrorObject | null {
  if (!rule.enum) {
    return null;
  }
  if (rule.enum.includes(value as string)) {
    return null;
  }
  return buildError(rule, enumMessage(rule.key, rule.enum));
}

function validatePattern(
  value: unknown,
  rule: AttributeRule,
): ApiErrorObject | null {
  if (!rule.pattern) {
    return null;
  }
  if (typeof value === "string" && rule.pattern.test(value)) {
    return null;
  }
  return buildError(rule, rule.patternMessage ?? patternMessage(rule.key));
}

function validateRule(
  attributes: Record<string, unknown>,
  rule: AttributeRule,
): ApiErrorObject | null {
  const value = attributes[rule.key];

  const presenceError = validatePresence(value, rule);
  if (presenceError !== null) {
    return presenceError;
  }
  if (isAbsent(value)) {
    return null;
  }

  return (
    validateType(value, rule) ??
    validateEnum(value, rule) ??
    validatePattern(value, rule)
  );
}

export function apiValidate(body: ApiRequest, rules: AttributeRule[]): void {
  const safeBody = body as { data?: { attributes?: Record<string, unknown> } };
  const attributes = safeBody.data?.attributes ?? {};
  const errors = rules
    .map((rule) => validateRule(attributes, rule))
    .filter((error): error is ApiErrorObject => error !== null);

  if (errors.length === 0) {
    return;
  }

  throw new ApiError(errors, 422);
}
