import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppUrl } from "../../../server/utils/appUrl";

const APP_URL_ENV = "NUXT_PUBLIC_APP_URL";
const originalAppUrl = process.env[APP_URL_ENV];

beforeEach(() => {
  delete process.env[APP_URL_ENV];
});

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env[APP_URL_ENV];
    return;
  }
  process.env[APP_URL_ENV] = originalAppUrl;
});

describe("buildAppUrl", () => {
  it("returns the configured app URL", () => {
    process.env[APP_URL_ENV] = "https://custom-domain.example.com";
    expect(buildAppUrl()).toBe("https://custom-domain.example.com");
  });

  it("strips a trailing slash", () => {
    process.env[APP_URL_ENV] = "https://custom-domain.example.com/";
    expect(buildAppUrl()).toBe("https://custom-domain.example.com");
  });

  it("throws when the app URL is not configured", () => {
    expect(() => buildAppUrl()).toThrow(`${APP_URL_ENV} is not set`);
  });
});
