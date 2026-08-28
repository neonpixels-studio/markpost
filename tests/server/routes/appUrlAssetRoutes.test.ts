import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const TEST_APP_URL = "https://custom.example.com";

const mockSetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: openApiHandler } =
  await import("../../../server/routes/openapi.json.get");
const { default: llmsHandler } =
  await import("../../../server/routes/llms.txt.get");
const { default: sitemapHandler } =
  await import("../../../server/routes/sitemap.xml.get");

const event = {} as H3Event;

vi.stubGlobal("setHeader", mockSetHeader);

let previousAppUrl: string | undefined;

beforeEach(() => {
  previousAppUrl = process.env.NUXT_PUBLIC_APP_URL;
  process.env.NUXT_PUBLIC_APP_URL = TEST_APP_URL;
  mockSetHeader.mockReset();
});

afterEach(() => {
  if (previousAppUrl === undefined) {
    delete process.env.NUXT_PUBLIC_APP_URL;
    return;
  }
  process.env.NUXT_PUBLIC_APP_URL = previousAppUrl;
});

describe("GET /openapi.json", () => {
  it("serves JSON with the interpolated app URL", async () => {
    const body = (await openApiHandler(event)) as string;
    const spec = JSON.parse(body);

    expect(mockSetHeader).toHaveBeenCalledWith(
      event,
      "Content-Type",
      "application/json; charset=utf-8",
    );
    expect(spec.servers?.[0]?.url).toBe(`${TEST_APP_URL}/api`);
    expect(body).not.toContain("{{APP_URL}}");
  });
});

describe("GET /llms.txt", () => {
  it("serves plain text with the interpolated app URL", async () => {
    const body = (await llmsHandler(event)) as string;

    expect(mockSetHeader).toHaveBeenCalledWith(
      event,
      "Content-Type",
      "text/plain; charset=utf-8",
    );
    expect(body).toContain(`Base URL: ${TEST_APP_URL}.`);
    expect(body).not.toContain("{{APP_URL}}");
  });
});

describe("GET /sitemap.xml", () => {
  it("serves XML with the interpolated app URL", async () => {
    const body = (await sitemapHandler(event)) as string;

    expect(mockSetHeader).toHaveBeenCalledWith(
      event,
      "Content-Type",
      "application/xml; charset=utf-8",
    );
    expect(body).toContain(`<loc>${TEST_APP_URL}/</loc>`);
    expect(body).not.toContain("{{APP_URL}}");
  });
});
