import { describe, it, expect } from "vitest";
import {
  convertHtmlToMarkdown,
  titleToSlug,
  buildFilename,
  buildFrontmatter,
  serializeFrontmatter,
  parseWebhookPayload,
  parseEmailPayload,
  assembleMarkdownDocument,
} from "../../../server/utils/markdown";

describe("convertHtmlToMarkdown", () => {
  it("converts a paragraph to plain text", () => {
    const result = convertHtmlToMarkdown("<p>Hello world</p>");
    expect(result).toBe("Hello world");
  });

  it("converts a heading", () => {
    const result = convertHtmlToMarkdown("<h1>Deploy succeeded</h1>");
    expect(result).toBe("# Deploy succeeded");
  });

  it("converts bold text", () => {
    const result = convertHtmlToMarkdown(
      "<p>Commit <strong>a1f9c20</strong> shipped</p>",
    );
    expect(result).toBe("Commit **a1f9c20** shipped");
  });

  it("converts an unordered list", () => {
    const result = convertHtmlToMarkdown(
      "<ul><li>Alpha</li><li>Beta</li></ul>",
    );
    // turndown uses bulletListMarker "-" with trailing spaces before the item text
    expect(result).toContain("Alpha");
    expect(result).toContain("Beta");
    expect(result).toMatch(/^-/);
  });

  it("returns empty string for empty HTML", () => {
    const result = convertHtmlToMarkdown("");
    expect(result).toBe("");
  });

  it("strips tags for unsupported elements", () => {
    const result = convertHtmlToMarkdown("<span>plain</span>");
    expect(result).toBe("plain");
  });

  it("converts an HTML table to a GFM markdown table", () => {
    const result = convertHtmlToMarkdown(
      "<table><thead><tr><th>Service</th><th>Status</th></tr></thead>" +
        "<tbody><tr><td>API</td><td>Up</td></tr>" +
        "<tr><td>Worker</td><td>Down</td></tr></tbody></table>",
    );

    // Header row, separator row, and each data row preserved with cells
    // still pipe-delimited, instead of collapsing into bare paragraphs with
    // no row/column structure. Cell values are trimmed since the renderer
    // pads cells with spaces to align columns.
    expect(tableRows(result)).toEqual([
      ["Service", "Status"],
      ["---", "---"],
      ["API", "Up"],
      ["Worker", "Down"],
    ]);
  });

  it("converts a table with no header row instead of keeping raw HTML", () => {
    const result = convertHtmlToMarkdown(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
    );

    expect(result).not.toContain("<table");
    expect(tableRows(result)).toEqual([
      ["", ""],
      ["---", "---"],
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("returns an empty string for an empty table instead of throwing", () => {
    expect(convertHtmlToMarkdown("<table></table>")).toBe("");
  });

  it("escapes a pipe character inside a cell instead of corrupting columns", () => {
    const result = convertHtmlToMarkdown(
      "<table><thead><tr><th>Col</th></tr></thead>" +
        "<tbody><tr><td>a | b</td></tr></tbody></table>",
    );

    expect(tableRows(result)).toEqual([["Col"], ["---"], ["a \\| b"]]);
  });

  it("falls back to raw HTML for a table with block content in a cell", () => {
    // A cell holding a list, heading, blockquote, or nested table can't be
    // flattened into a single GFM table cell, so the renderer intentionally
    // keeps the whole table as HTML rather than losing that structure. This
    // pins down that documented fallback so a future dependency bump can't
    // silently change it back to flattened paragraphs.
    const result = convertHtmlToMarkdown(
      "<table><tr><td><ul><li>a</li><li>b</li></ul></td><td>plain</td></tr></table>",
    );

    expect(result).toContain("<table");
    expect(result).toContain("<li>a</li>");
  });

  it("keeps a <br> inside a cell on the same row instead of breaking the table", () => {
    const result = convertHtmlToMarkdown(
      "<table><thead><tr><th>Col</th></tr></thead>" +
        "<tbody><tr><td>line1<br>line2</td></tr></tbody></table>",
    );

    const lines = result.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("<br>");
  });
});

// Splits a markdown table row into its cell values, trimming the alignment
// padding the renderer adds and ignoring escaped pipes (`\|`) inside a cell
// so they aren't mistaken for column separators. Assumes a cell never ends in
// a literal backslash (none of the cases above do) -- that would read as an
// escaped pipe and merge two cells.
function tableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("titleToSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(titleToSlug("Production Deploy Succeeded")).toBe(
      "production-deploy-succeeded",
    );
  });

  it("removes non-alphanumeric characters", () => {
    expect(titleToSlug("Hello, World! (2026)")).toBe("hello-world-2026");
  });

  it("collapses multiple hyphens into one", () => {
    expect(titleToSlug("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(titleToSlug("  hello world  ")).toBe("hello-world");
  });

  it("truncates at 80 characters", () => {
    const longTitle = "a".repeat(100);
    expect(titleToSlug(longTitle).length).toBeLessThanOrEqual(80);
  });

  it("returns fallback slug for an empty title", () => {
    expect(titleToSlug("")).toBe("untitled");
  });

  it("returns fallback slug for an all-symbol title", () => {
    expect(titleToSlug("!!!")).toBe("untitled");
  });

  it("removes leading and trailing hyphens", () => {
    expect(titleToSlug("-start")).toBe("start");
    expect(titleToSlug("end-")).toBe("end");
  });

  it("returns fallback slug for non-Latin-script titles", () => {
    expect(titleToSlug("Привет мир")).toBe("untitled");
    expect(titleToSlug("日本語のタイトル")).toBe("untitled");
    expect(titleToSlug("مرحبا بالعالم")).toBe("untitled");
  });

  it("folds accented Latin letters to their ASCII base", () => {
    expect(titleToSlug("Café Meeting")).toBe("cafe-meeting");
    expect(titleToSlug("Zürich Naïve")).toBe("zurich-naive");
  });

  it("keeps ASCII produced by compatibility decomposition", () => {
    expect(titleToSlug("№5 Meeting")).toBe("no5-meeting");
  });

  it("keeps ASCII words when non-Latin characters are interspersed", () => {
    expect(titleToSlug("Deploy 部署 v2")).toBe("deploy-v2");
  });

  it("treats non-ASCII whitespace as a word separator", () => {
    expect(titleToSlug("Hello\u00A0World")).toBe("hello-world");
    expect(titleToSlug("Deploy\u3000v2")).toBe("deploy-v2");
  });
});

describe("buildFilename", () => {
  const referenceDate = new Date("2026-06-14T09:41:02Z");

  it("replaces {{date}} with YYYY-MM-DD", () => {
    const result = buildFilename(
      "{{date}}-{{slug}}.md",
      referenceDate,
      "Production Deploy",
      "webhook",
    );
    expect(result).toBe("2026-06-14-production-deploy.md");
  });

  it("replaces {{source}} in the template", () => {
    const result = buildFilename(
      "{{source}}/{{slug}}.md",
      referenceDate,
      "Deploy",
      "github",
    );
    expect(result).toBe("github/deploy.md");
  });

  it("replaces {{slug}} with a slugified title", () => {
    const result = buildFilename(
      "{{slug}}.md",
      referenceDate,
      "Hello World",
      "webhook",
    );
    expect(result).toBe("hello-world.md");
  });

  it("replaces all occurrences when a token appears multiple times", () => {
    const result = buildFilename(
      "{{date}}/{{date}}-{{slug}}.md",
      referenceDate,
      "My Note",
      "webhook",
    );
    expect(result).toBe("2026-06-14/2026-06-14-my-note.md");
  });

  it("strips traversal segments from a malicious filename template", () => {
    const result = buildFilename(
      "../../{{slug}}.md",
      referenceDate,
      "Escape",
      "webhook",
    );
    expect(result).not.toContain("..");
    expect(result).not.toMatch(/^\//);
  });
});

describe("buildFrontmatter", () => {
  it("builds a frontmatter object with all fields", () => {
    const result = buildFrontmatter(
      "Production deploy succeeded",
      "webhook/github",
      "2026-06-14T09:41:02Z",
      ["ci", "deploy"],
    );

    expect(result).toEqual({
      title: "Production deploy succeeded",
      source: "webhook/github",
      created: "2026-06-14T09:41:02Z",
      tags: ["ci", "deploy"],
    });
  });

  it("accepts an empty tags array", () => {
    const result = buildFrontmatter(
      "Note",
      "webhook",
      "2026-06-14T00:00:00Z",
      [],
    );
    expect(result.tags).toEqual([]);
  });
});

describe("serializeFrontmatter", () => {
  it("serializes a frontmatter object to YAML block", () => {
    const frontmatter = buildFrontmatter(
      "Production deploy succeeded",
      "webhook/github",
      "2026-06-14T09:41:02Z",
      ["ci", "deploy", "incoming"],
    );

    const result = serializeFrontmatter(frontmatter);

    expect(result).toBe(
      "---\ntitle: Production deploy succeeded\nsource: webhook/github\ncreated: 2026-06-14T09:41:02Z\ntags: [ci, deploy, incoming]\n---",
    );
  });

  it("serializes empty tags as an empty array", () => {
    const frontmatter = buildFrontmatter(
      "Note",
      "webhook",
      "2026-06-14T00:00:00Z",
      [],
    );
    const result = serializeFrontmatter(frontmatter);
    expect(result).toContain("tags: []");
  });

  it("quotes a title containing a colon to prevent YAML parsing errors", () => {
    const frontmatter = buildFrontmatter(
      "Deploy: success",
      "webhook",
      "2026-06-14T00:00:00Z",
      [],
    );
    const result = serializeFrontmatter(frontmatter);
    expect(result).toContain('title: "Deploy: success"');
  });

  it("escapes a newline in a title so it cannot inject a new frontmatter key", () => {
    const frontmatter = buildFrontmatter(
      "title\nmalicious: true",
      "webhook",
      "2026-06-14T00:00:00Z",
      [],
    );
    const result = serializeFrontmatter(frontmatter);
    // The title must be on a single quoted line; \n must be escaped to \\n.
    // A real YAML parser reading this will see one string value, not two keys.
    expect(result).toContain("\\n");
    // The result must not contain a bare (unquoted) newline followed by "malicious:"
    // which would create an independent YAML key.
    const lines = result.split("\n");
    expect(lines.every((line) => !line.startsWith("malicious:"))).toBe(true);
  });

  it("quotes a tag containing a comma", () => {
    const frontmatter = buildFrontmatter(
      "Note",
      "webhook",
      "2026-06-14T00:00:00Z",
      ["a,b"],
    );
    const result = serializeFrontmatter(frontmatter);
    expect(result).toContain('"a,b"');
  });

  it("quotes a tag containing a closing bracket", () => {
    const frontmatter = buildFrontmatter(
      "Note",
      "webhook",
      "2026-06-14T00:00:00Z",
      ["a]b"],
    );
    const result = serializeFrontmatter(frontmatter);
    expect(result).toContain('"a]b"');
  });

  it("quotes a value with trailing whitespace so YAML does not strip it silently", () => {
    const frontmatter = buildFrontmatter(
      "trailing space ",
      "webhook",
      "2026-06-14T00:00:00Z",
      [],
    );
    const result = serializeFrontmatter(frontmatter);
    expect(result).toContain('"trailing space "');
  });
});

describe("parseWebhookPayload", () => {
  const settings = { filenameTemplate: "{{date}}-{{slug}}.md" };

  it("extracts title, body, frontmatter, tags, and filePath from a JSON payload with html", () => {
    const payload = {
      title: "Production deploy succeeded",
      html: "<p>Commit <strong>a1f9c20</strong> shipped to prod</p>",
      source: "webhook/github",
      tags: ["ci", "deploy"],
      created: "2026-06-14T09:41:02Z",
    };

    const result = parseWebhookPayload(payload, settings);

    expect(result.title).toBe("Production deploy succeeded");
    expect(result.body).toContain("a1f9c20");
    expect(result.body).toContain("shipped to prod");
    expect(result.frontmatter).toEqual({
      title: "Production deploy succeeded",
      source: "webhook/github",
      created: "2026-06-14T09:41:02.000Z",
      tags: ["ci", "deploy"],
    });
    expect(result.tags).toEqual(["ci", "deploy"]);
    expect(result.filePath).toBe("2026-06-14-production-deploy-succeeded.md");
  });

  it("falls back to plain text content when no html field is present", () => {
    const payload = {
      title: "Plain text note",
      content: "Just some text",
      source: "webhook/github",
      created: "2026-06-14T09:41:02Z",
    };

    const result = parseWebhookPayload(payload, settings);

    expect(result.body).toBe("Just some text");
  });

  it("uses defaults when optional fields are absent", () => {
    const payload = {
      title: "Bare minimum",
      content: "body",
    };

    const result = parseWebhookPayload(payload, settings);

    expect(result.frontmatter.source).toBe("webhook");
    expect(result.tags).toEqual([]);
    expect(result.filePath).toMatch(/^\d{4}-\d{2}-\d{2}-bare-minimum\.md$/);
  });

  it("falls back to Untitled when title is absent", () => {
    const payload = { content: "something" };
    const result = parseWebhookPayload(payload, settings);
    expect(result.title).toBe("Untitled");
  });

  it("uses a custom filename template from settings", () => {
    const customSettings = { filenameTemplate: "{{source}}/{{slug}}.md" };
    const payload = {
      title: "Deploy",
      html: "<p>done</p>",
      source: "github",
      created: "2026-06-14T00:00:00Z",
    };

    const result = parseWebhookPayload(payload, customSettings);

    expect(result.filePath).toBe("github/deploy.md");
  });

  it("falls back to the current date when created is an invalid date string", () => {
    const payload = {
      title: "Bad date",
      content: "hello",
      created: "yesterday",
    };

    const result = parseWebhookPayload(payload, settings);

    expect(result.filePath).not.toContain("NaN");
    expect(result.frontmatter.created).not.toBe("yesterday");
  });
});

describe("parseEmailPayload", () => {
  const settings = { filenameTemplate: "{{date}}-{{slug}}.md" };

  it("extracts title from subject and converts html body", () => {
    const payload = {
      subject: "Weekly digest",
      html: "<p>Here are <strong>5 updates</strong> this week.</p>",
      from: "newsletters@example.com",
      date: "2026-06-14T08:00:00Z",
      tags: ["newsletter"],
    };

    const result = parseEmailPayload(payload, settings);

    expect(result.title).toBe("Weekly digest");
    expect(result.body).toContain("5 updates");
    expect(result.frontmatter).toEqual({
      title: "Weekly digest",
      source: "email/newsletters@example.com",
      created: "2026-06-14T08:00:00.000Z",
      tags: ["newsletter"],
    });
    expect(result.filePath).toBe("2026-06-14-weekly-digest.md");
  });

  it("falls back to plain text when no html field is present", () => {
    const payload = {
      subject: "Plain email",
      text: "Just plain text content",
      from: "user@example.com",
      date: "2026-06-14T08:00:00Z",
    };

    const result = parseEmailPayload(payload, settings);

    expect(result.body).toBe("Just plain text content");
  });

  it("uses Untitled when subject is absent", () => {
    const payload = { text: "hello", date: "2026-06-14T08:00:00Z" };
    const result = parseEmailPayload(payload, settings);
    expect(result.title).toBe("Untitled");
  });

  it("sets source to email/unknown when from is absent", () => {
    const payload = { subject: "Note", text: "body" };
    const result = parseEmailPayload(payload, settings);
    expect(result.frontmatter.source).toBe("email/unknown");
  });
});

describe("assembleMarkdownDocument", () => {
  it("combines frontmatter block and body into a full markdown document", () => {
    const parsedPayload = {
      title: "Deploy",
      body: "Commit a1f9c20 shipped.",
      frontmatter: buildFrontmatter(
        "Deploy",
        "webhook/github",
        "2026-06-14T09:41:02Z",
        ["ci"],
      ),
      tags: ["ci"],
      filePath: "2026-06-14-deploy.md",
    };

    const result = assembleMarkdownDocument(parsedPayload);

    expect(result).toContain("---\ntitle: Deploy");
    expect(result).toContain("# Deploy");
    expect(result).toContain("Commit a1f9c20 shipped.");
  });

  it("places frontmatter before the heading", () => {
    const parsedPayload = {
      title: "My Note",
      body: "Content here.",
      frontmatter: buildFrontmatter(
        "My Note",
        "webhook",
        "2026-06-14T00:00:00Z",
        [],
      ),
      tags: [],
      filePath: "2026-06-14-my-note.md",
    };

    const result = assembleMarkdownDocument(parsedPayload);
    const frontmatterEnd = result.indexOf("---\n\n");

    expect(frontmatterEnd).toBeGreaterThan(-1);
    expect(result.indexOf("# My Note")).toBeGreaterThan(frontmatterEnd);
  });
});

describe("convertHtmlToMarkdown sanitization", () => {
  const blockTable = (cell: string, tableAttributes = "") =>
    `<table${tableAttributes}><tr><th>H</th></tr><tr><td>${cell}</td></tr></table>`;

  it("keeps a table with block content as sanitized raw HTML", () => {
    const result = convertHtmlToMarkdown(
      blockTable("<ul><li>one</li><li>two</li></ul>"),
    );
    expect(result).toContain("<table>");
    expect(result).toContain("<li>one</li>");
  });

  it("strips event handler and style attributes from the kept table", () => {
    const result = convertHtmlToMarkdown(
      blockTable(
        '<ul onmouseover="alert(1)" style="x:y"><li class="c" onclick="x()">one</li></ul>',
        ' onclick="alert(2)" class="evil" id="a"',
      ),
    );
    expect(result).toContain("<li>one</li>");
    expect(result).not.toMatch(/onclick|onmouseover|style=|class="evil"|id=/);
  });

  it("removes script and iframe elements with their content from the kept table", () => {
    const result = convertHtmlToMarkdown(
      blockTable(
        '<ul><li>ok</li></ul><script>alert(1)</script><iframe src="https://evil.test"></iframe>',
      ),
    );
    expect(result).not.toMatch(/script|iframe|alert/);
    expect(result).toContain("ok");
  });

  it("unwraps unknown tags in the kept table but keeps their text", () => {
    const result = convertHtmlToMarkdown(
      blockTable("<ul><li><custom-tag>kept text</custom-tag></li></ul>"),
    );
    expect(result).not.toContain("custom-tag");
    expect(result).toContain("kept text");
  });

  it("removes javascript: hrefs and obfuscated variants inside the kept table", () => {
    const result = convertHtmlToMarkdown(
      blockTable(
        '<ul><li><a href="javascript:alert(1)">a</a><a href="  JaVa\tScript:alert(1)">b</a><a href="https://ok.test">c</a></li></ul>',
      ),
    );
    expect(result).not.toMatch(/javascript/i);
    expect(result).toContain('href="https://ok.test"');
  });

  it("removes data: image sources inside the kept table", () => {
    const result = convertHtmlToMarkdown(
      blockTable('<ul><li><img src="data:text/html,x" alt="a"></li></ul>'),
    );
    expect(result).not.toContain("data:");
  });

  it("still flattens simple tables to GFM", () => {
    const result = convertHtmlToMarkdown(
      '<table onclick="x()"><tr><th>A</th></tr><tr><td>1</td></tr></table>',
    );
    expect(result).toMatch(/\| A +\|/);
    expect(result).not.toContain("<table");
  });

  it("drops javascript: link URLs but keeps the link text", () => {
    const result = convertHtmlToMarkdown(
      '<p><a href="javascript:alert(1)">click</a></p>',
    );
    expect(result).toBe("click");
  });

  it("drops data: and vbscript: link URLs", () => {
    expect(
      convertHtmlToMarkdown('<a href="data:text/html,<b>x</b>">x</a>'),
    ).toBe("x");
    expect(convertHtmlToMarkdown('<a href="vbscript:x">y</a>')).toBe("y");
  });

  it("keeps http, https, mailto, relative, and fragment links", () => {
    expect(convertHtmlToMarkdown('<a href="http://a.test">a</a>')).toBe(
      "[a](http://a.test)",
    );
    expect(convertHtmlToMarkdown('<a href="https://a.test">a</a>')).toBe(
      "[a](https://a.test)",
    );
    expect(convertHtmlToMarkdown('<a href="mailto:a@b.test">a</a>')).toBe(
      "[a](mailto:a@b.test)",
    );
    expect(convertHtmlToMarkdown('<a href="/rel">a</a>')).toBe("[a](/rel)");
    expect(convertHtmlToMarkdown('<a href="#top">a</a>')).toBe("[a](#top)");
  });

  it("drops images with disallowed schemes and keeps https images", () => {
    expect(
      convertHtmlToMarkdown('<img src="javascript:alert(1)" alt="x">'),
    ).toBe("");
    expect(
      convertHtmlToMarkdown('<img src="data:image/png;base64,AA" alt="x">'),
    ).toBe("");
    expect(
      convertHtmlToMarkdown('<img src="https://a.test/i.png" alt="x">'),
    ).toBe("![x](https://a.test/i.png)");
  });

  it("rejects entity and backslash obfuscated schemes in links and images", () => {
    expect(
      convertHtmlToMarkdown('<a href="javascript&amp;#58;alert(1)">x</a>'),
    ).toBe("x");
    expect(convertHtmlToMarkdown('<a href="javascript\\:alert(1)">x</a>')).toBe(
      "x",
    );
    expect(
      convertHtmlToMarkdown('<img src="javascript&amp;#58;alert(1)" alt="x">'),
    ).toBe("");
  });

  it("removes svg elements with their content from the kept table", () => {
    const result = convertHtmlToMarkdown(
      blockTable("<ul><li>ok</li></ul><svg><style>secret</style></svg>"),
    );
    expect(result).not.toContain("secret");
    expect(result).toContain("ok");
  });

  it("allows query strings containing ampersands", () => {
    expect(
      convertHtmlToMarkdown('<a href="https://a.test/?a=1&amp;b=2">x</a>'),
    ).toBe("[x](https://a.test/?a=1&b=2)");
  });

  it("keeps relative links containing a literal ampersand", () => {
    expect(
      convertHtmlToMarkdown('<a href="terms&amp;conditions.html">x</a>'),
    ).toBe("[x](terms&conditions.html)");
  });

  it("leaves links without an href as plain text", () => {
    expect(convertHtmlToMarkdown("<a>text</a>")).toBe("text");
    expect(convertHtmlToMarkdown('<a href="">text</a>')).toBe("text");
  });

  it("does not let blank lines in attributes or pre text escape the kept table", () => {
    const attributeEscape = convertHtmlToMarkdown(
      blockTable(
        '<ul><li><img src="https://a.test/i.png" alt="x&#10;&#10;<img src=x onerror=alert(1)>&#10;"></li></ul>',
      ),
    );
    const preEscape = convertHtmlToMarkdown(
      blockTable("<ul><li><pre>a\n\n[x](javascript:alert(1))</pre></li></ul>"),
    );
    for (const result of [attributeEscape, preEscape]) {
      expect(result).not.toMatch(/\n[ \t]*\n(?=[^]*<\/table>)/);
    }
    expect(attributeEscape).not.toContain("<img src=x");
  });

  it("does not let comments or carriage returns in pre text escape the kept table", () => {
    const comment = convertHtmlToMarkdown(
      blockTable(
        "<ul><li><pre><!--\n\n<img src=x onerror=alert(1)>--></pre></li></ul>",
      ),
    );
    const carriageReturn = convertHtmlToMarkdown(
      blockTable("<ul><li><pre>a&#13;&#13;<b>b</b></pre></li></ul>"),
    );
    expect(comment).not.toContain("onerror");
    expect(carriageReturn).not.toMatch(/\r/);
    expect(carriageReturn).not.toMatch(/\n[ \t]*\n(?=[^]*<\/table>)/);
  });

  it("drops links and images whose URL or title contains a backslash", () => {
    expect(
      convertHtmlToMarkdown('<a href="https://a.test/\\)\\<x//\\>">t</a>'),
    ).toBe("t");
    expect(
      convertHtmlToMarkdown('<a href="https://a.test" title="\\&quot;)">t</a>'),
    ).toBe("t");
    expect(
      convertHtmlToMarkdown('<img src="https://a.test/\\x" alt="x">'),
    ).toBe("");
  });
});
