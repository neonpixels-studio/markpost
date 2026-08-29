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
});

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
