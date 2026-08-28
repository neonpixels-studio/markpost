import { describe, expect, it } from "vitest";
import {
  isKnownPath,
  markdownForRoute,
  normalizePath,
  notFoundMarkdown,
  resolveMarkdownRoute,
  wantsMarkdown,
} from "../../../server/utils/agentContent";

const APP_URL = "https://custom-domain.example.com";

describe("agentContent util", () => {
  describe("normalizePath", () => {
    it("keeps the root path as-is", () => {
      expect(normalizePath("/")).toBe("/");
    });

    it("strips the query string", () => {
      expect(normalizePath("/docs?foo=bar")).toBe("/docs");
    });

    it("strips a trailing slash", () => {
      expect(normalizePath("/docs/")).toBe("/docs");
    });

    it("collapses a bare trailing slash to root", () => {
      expect(normalizePath("/?x=1")).toBe("/");
    });
  });

  describe("wantsMarkdown", () => {
    it("is true for an explicit text/markdown Accept", () => {
      expect(wantsMarkdown("text/markdown", "/")).toBe(true);
    });

    it("is true for text/x-markdown", () => {
      expect(wantsMarkdown("text/x-markdown", "/")).toBe(true);
    });

    it("is true for a .md suffix regardless of Accept", () => {
      expect(wantsMarkdown("text/html", "/docs.md")).toBe(true);
    });

    it("is false for a browser Accept header", () => {
      expect(
        wantsMarkdown(
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "/",
        ),
      ).toBe(false);
    });

    it("is false when Accept is absent", () => {
      expect(wantsMarkdown(undefined, "/")).toBe(false);
    });

    it("is false when markdown is ranked below html", () => {
      expect(wantsMarkdown("text/markdown;q=0.5,text/html;q=0.9", "/")).toBe(
        false,
      );
    });

    it("is true when markdown outranks html", () => {
      expect(wantsMarkdown("text/html;q=0.5,text/markdown;q=0.9", "/")).toBe(
        true,
      );
    });

    it("is false when markdown is explicitly rejected with q=0", () => {
      expect(wantsMarkdown("text/markdown;q=0", "/")).toBe(false);
    });
  });

  describe("isKnownPath", () => {
    it("recognizes first-party pages", () => {
      expect(isKnownPath("/docs")).toBe(true);
      expect(isKnownPath("/")).toBe(true);
      expect(isKnownPath("/settings/")).toBe(true);
      expect(isKnownPath("/docs.md")).toBe(true);
    });

    it("rejects unknown paths", () => {
      expect(isKnownPath("/does-not-exist")).toBe(false);
      expect(isKnownPath("/vault/secret")).toBe(false);
    });
  });

  describe("resolveMarkdownRoute / markdownForRoute", () => {
    it("resolves content routes, including the .md suffix", () => {
      expect(resolveMarkdownRoute("/docs")).toBe("/docs");
      expect(resolveMarkdownRoute("/docs.md")).toBe("/docs");
      expect(resolveMarkdownRoute("/")).toBe("/");
    });

    it("returns null for non-content routes", () => {
      expect(resolveMarkdownRoute("/inbox")).toBeNull();
      expect(resolveMarkdownRoute("/nope")).toBeNull();
    });

    it("returns Markdown bodies for content routes", () => {
      expect(markdownForRoute("/", APP_URL)).toContain("# Markpost");
      expect(markdownForRoute("/docs", APP_URL)).toContain("documentation");
      expect(markdownForRoute("/pricing", APP_URL)).toContain("pricing");
    });

    it("advertises the supplied app URL as the API base", () => {
      expect(markdownForRoute("/", APP_URL)).toContain(`${APP_URL}/api`);
      expect(markdownForRoute("/docs", APP_URL)).toContain(`${APP_URL}/api`);
    });

    it("does not advertise the hardcoded Netlify preview host", () => {
      expect(markdownForRoute("/", APP_URL)).not.toContain(
        "dh-markpost.netlify.app",
      );
      expect(markdownForRoute("/docs", APP_URL)).not.toContain(
        "dh-markpost.netlify.app",
      );
    });

    it("builds the pricing page without embedding the app URL", () => {
      expect(markdownForRoute("/pricing", APP_URL)).not.toContain(APP_URL);
    });

    it("returns null Markdown for non-content routes", () => {
      expect(markdownForRoute("/inbox", APP_URL)).toBeNull();
    });
  });

  describe("notFoundMarkdown", () => {
    it("echoes the requested path and points at discovery resources", () => {
      const body = notFoundMarkdown("/vault/missing?x=1");
      expect(body).toContain("404");
      expect(body).toContain("/vault/missing");
      expect(body).toContain("/sitemap.xml");
      expect(body).toContain("/llms.txt");
      expect(body).toContain("/openapi.json");
    });
  });
});
