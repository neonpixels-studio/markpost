import { describe, it, expect } from "vitest";
import {
  isSafeImageUrl,
  isSafeLinkUrl,
} from "../../../server/utils/sanitizeHtml";

describe("isSafeLinkUrl", () => {
  it.each([
    "http://a.test",
    "HTTPS://a.test",
    "mailto:a@b.test",
    "//a.test/x",
    "/relative",
    "#fragment",
    "page.html?a=1&amp=2",
  ])("allows %s", (url) => {
    expect(isSafeLinkUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "\u0001javascript:alert(1)",
    " Java\tScript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "javascript&#58;alert(1)",
    "javascript\\:alert(1)",
  ])("rejects %j", (url) => {
    expect(isSafeLinkUrl(url)).toBe(false);
  });
});

describe("isSafeImageUrl", () => {
  it("allows http and https but not mailto, data, or vbscript", () => {
    expect(isSafeImageUrl("https://a.test/i.png")).toBe(true);
    expect(isSafeImageUrl("mailto:a@b.test")).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,AA")).toBe(false);
    expect(isSafeImageUrl("vbscript:x")).toBe(false);
  });
});
