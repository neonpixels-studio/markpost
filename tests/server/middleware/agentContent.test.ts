import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const mockGetHeader = vi.fn();
const mockSetResponseHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../server/middleware/agentContent");

type TestEvent = H3Event & { method: string; path: string };

function buildEvent(path: string, method = "GET"): TestEvent {
  return { path, method } as unknown as TestEvent;
}

beforeEach(() => {
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("setResponseHeader", mockSetResponseHeader);
  mockGetHeader.mockReset();
  mockSetResponseHeader.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agentContent middleware", () => {
  it("returns a Markdown 404 for an unknown path when Markdown is negotiated", async () => {
    mockGetHeader.mockReturnValue("text/markdown");

    const result = (await handler(
      buildEvent("/does-not-exist"),
    )) as unknown as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(404);
    expect(result.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(result.headers.get("vary")).toBe("Accept, Accept-Encoding");
    expect(await result.text()).toContain("/does-not-exist");
  });

  it("serves the Markdown representation of a content route when negotiated", async () => {
    mockGetHeader.mockReturnValue("text/markdown");

    const result = (await handler(buildEvent("/docs"))) as unknown as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(result.headers.get("vary")).toBe("Accept, Accept-Encoding");
    expect(await result.text()).toContain("documentation");
  });

  it("serves Markdown for a .md suffix regardless of Accept", async () => {
    mockGetHeader.mockReturnValue("text/html");

    const result = (await handler(
      buildEvent("/pricing.md"),
    )) as unknown as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain("pricing");
  });

  it("sets Vary: Accept on the HTML variant of a content route", async () => {
    mockGetHeader.mockReturnValue("text/html");

    const result = await handler(buildEvent("/pricing"));

    expect(result).toBeUndefined();
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Vary",
      "Accept, Accept-Encoding",
    );
  });

  it("passes through for a known non-content path", async () => {
    mockGetHeader.mockReturnValue("text/markdown");

    const result = await handler(buildEvent("/inbox"));

    expect(result).toBeUndefined();
    expect(mockSetResponseHeader).not.toHaveBeenCalled();
  });

  it("passes through for an unknown path when Markdown is not negotiated", async () => {
    mockGetHeader.mockReturnValue("text/html");

    const result = await handler(buildEvent("/does-not-exist"));

    expect(result).toBeUndefined();
  });

  it("ignores API paths", async () => {
    mockGetHeader.mockReturnValue("text/markdown");

    const result = await handler(buildEvent("/api/records/does-not-exist"));

    expect(result).toBeUndefined();
  });

  it("ignores non-GET methods", async () => {
    mockGetHeader.mockReturnValue("text/markdown");

    const result = await handler(buildEvent("/does-not-exist", "POST"));

    expect(result).toBeUndefined();
  });

  it("serves RFC 9728 protected-resource metadata", async () => {
    mockGetHeader.mockReturnValue(undefined);

    const result = (await handler(
      buildEvent("/.well-known/oauth-protected-resource"),
    )) as unknown as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    const body = JSON.parse(await result.text());
    expect(body.resource).toMatch(/\/api$/);
    expect(body.scopes_supported).toContain("records:read");
  });
});
