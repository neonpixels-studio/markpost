import { describe, it, expect } from "vitest";
import {
  applyFieldMapping,
  buildRawWebhookPayload,
} from "../../../server/utils/fieldMapper";

describe("buildRawWebhookPayload", () => {
  it("picks title, content, html, tags, created from payload", () => {
    const result = buildRawWebhookPayload(
      {
        title: "Hello",
        content: "Body text",
        html: "<p>Body text</p>",
        tags: ["foo", "bar"],
        created: "2026-06-01T00:00:00Z",
      },
      "My Source",
    );
    expect(result).toEqual({
      title: "Hello",
      content: "Body text",
      html: "<p>Body text</p>",
      source: "My Source",
      tags: ["foo", "bar"],
      created: "2026-06-01T00:00:00Z",
    });
  });

  it("filters non-string values from tags array", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: ["valid", 42, null, "also-valid"] },
      "src",
    );
    expect(result.tags).toEqual(["valid", "also-valid"]);
  });

  it("returns undefined for missing optional fields", () => {
    const result = buildRawWebhookPayload({ title: "T", content: "C" }, "src");
    expect(result.html).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.created).toBeUndefined();
  });

  it("splits a comma-separated tags string on the raw path", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: "infra, urgent" },
      "src",
    );
    expect(result.tags).toEqual(["infra", "urgent"]);
  });

  it("extracts object tags via the name field on the raw path", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: [{ name: "bug" }] },
      "src",
    );
    expect(result.tags).toEqual(["bug"]);
  });

  it("returns undefined for a tags value that is neither string nor array", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: { name: "x" } },
      "src",
    );
    expect(result.tags).toBeUndefined();
  });

  it("parses a JSON-encoded array string into tags on the raw path", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: '["a","b"]' },
      "src",
    );
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("returns undefined for a null tags value on the raw path", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C", tags: null },
      "src",
    );
    expect(result.tags).toBeUndefined();
  });

  it("sets source to the sourceName when no source field in payload", () => {
    const result = buildRawWebhookPayload(
      { title: "T", content: "C" },
      "MySource",
    );
    expect(result.source).toBe("MySource");
  });
});

describe("applyFieldMapping", () => {
  it("falls back to buildRawWebhookPayload when fieldMapping is null", () => {
    const result = applyFieldMapping(
      { title: "Hello", content: "World" },
      null,
      "src",
    );
    expect(result.title).toBe("Hello");
    expect(result.content).toBe("World");
    expect(result.source).toBe("src");
  });

  it("falls back to buildRawWebhookPayload when fieldMapping is not an object", () => {
    const result = applyFieldMapping(
      { title: "Hello", content: "World" },
      "not-an-object",
      "src",
    );
    expect(result.title).toBe("Hello");
  });

  it("falls back to buildRawWebhookPayload when fieldMapping is an array", () => {
    const result = applyFieldMapping({ title: "T", content: "C" }, [], "src");
    expect(result.source).toBe("src");
  });

  it("maps payload fields using the fieldMapping paths", () => {
    const payload = {
      event: {
        name: "Deployment",
        body: "Deploy succeeded",
        labels: ["infra"],
        timestamp: "2026-06-01T00:00:00Z",
      },
    };
    const mapping = {
      title: "event.name",
      content: "event.body",
      tags: "event.labels",
      created: "event.timestamp",
    };
    const result = applyFieldMapping(payload, mapping, "CI/CD");
    expect(result.title).toBe("Deployment");
    expect(result.content).toBe("Deploy succeeded");
    expect(result.tags).toEqual(["infra"]);
    expect(result.created).toBe("2026-06-01T00:00:00Z");
    expect(result.source).toBe("CI/CD");
  });

  it("returns undefined for missing nested paths", () => {
    const result = applyFieldMapping(
      { top: {} },
      { title: "top.missing.deep" },
      "src",
    );
    expect(result.title).toBeUndefined();
  });

  it("uses sourceName as source when source mapping path is absent", () => {
    const result = applyFieldMapping(
      { name: "My Title", text: "Body" },
      { title: "name", content: "text" },
      "Configured Source",
    );
    expect(result.source).toBe("Configured Source");
  });

  it("uses mapped source value when source path is provided", () => {
    const result = applyFieldMapping(
      { src: "github/my-repo" },
      { source: "src" },
      "fallback",
    );
    expect(result.source).toBe("github/my-repo");
  });

  it("treats an empty-object fieldMapping as a valid mapping that produces no fields", () => {
    // An empty {} is a valid FieldMappingConfig; all pick* calls return undefined
    // because no paths are configured. Use fieldMapping: null to get raw passthrough.
    const result = applyFieldMapping({ title: "T", content: "C" }, {}, "src");
    expect(result.title).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.source).toBe("src");
  });

  it("does not traverse prototype keys via fieldMapping paths", () => {
    const result = applyFieldMapping(
      {},
      { title: "__proto__.polluted" },
      "src",
    );
    expect(result.title).toBeUndefined();
  });

  it("maps tags from an array of strings", () => {
    const result = applyFieldMapping(
      { labels: ["infra", "urgent"] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["infra", "urgent"]);
  });

  it("maps tags from a comma-separated string, trimming and dropping empties", () => {
    const result = applyFieldMapping(
      { labels: "infra, urgent ,, bug " },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["infra", "urgent", "bug"]);
  });

  it("maps tags from an array of objects using the name field (GitHub labels)", () => {
    const result = applyFieldMapping(
      {
        labels: [
          { id: 1, name: "bug" },
          { id: 2, name: "help wanted" },
        ],
      },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["bug", "help wanted"]);
  });

  it("extracts tags from objects using fallback keys when name is absent", () => {
    const result = applyFieldMapping(
      { labels: [{ title: "release" }, { value: "internal" }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["release", "internal"]);
  });

  it("extracts tags from objects using the label key", () => {
    const result = applyFieldMapping(
      { labels: [{ label: "ops" }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["ops"]);
  });

  it("prefers the name key over lower-priority keys when both are present", () => {
    const result = applyFieldMapping(
      { labels: [{ name: "a", title: "b" }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["a"]);
  });

  it("trims string array items and drops blank ones", () => {
    const result = applyFieldMapping(
      { labels: [" infra ", "  ", ""] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["infra"]);
  });

  it("does not split commas inside array string items", () => {
    const result = applyFieldMapping(
      { labels: ["a,b", "c"] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["a,b", "c"]);
  });

  it("falls through object keys in priority order, skipping blank values", () => {
    const result = applyFieldMapping(
      { labels: [{ name: "  ", title: "release" }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["release"]);
  });

  it("skips array items with no usable string field", () => {
    const result = applyFieldMapping(
      { labels: [{ name: "keep" }, { id: 5 }, 42, null, { name: "  " }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["keep"]);
  });

  it("maps a comma-separated string tag behind a nested path", () => {
    const result = applyFieldMapping(
      { event: { labels: "infra, urgent" } },
      { tags: "event.labels" },
      "src",
    );
    expect(result.tags).toEqual(["infra", "urgent"]);
  });

  it("returns an empty array for an empty tags array", () => {
    const result = applyFieldMapping({ labels: [] }, { tags: "labels" }, "src");
    expect(result.tags).toEqual([]);
  });

  it("falls through to a later object key when the priority key is a non-string", () => {
    const result = applyFieldMapping(
      { labels: [{ name: 5, title: "release" }] },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["release"]);
  });

  it("returns undefined for tags when the value is neither a string nor an array", () => {
    const result = applyFieldMapping(
      { labels: { name: "not-an-array" } },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toBeUndefined();
  });

  it("returns an empty array for a tags string with no usable values", () => {
    const result = applyFieldMapping(
      { labels: " , , " },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual([]);
  });

  it("parses a JSON-encoded array string into tags instead of splitting on commas", () => {
    const result = applyFieldMapping(
      { labels: '["infra","urgent"]' },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["infra", "urgent"]);
  });

  it("parses a JSON-encoded array of label objects into tags", () => {
    const result = applyFieldMapping(
      { labels: '[{"name":"bug"},{"name":"help wanted"}]' },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["bug", "help wanted"]);
  });

  it("falls back to comma splitting when a bracketed string is not valid JSON", () => {
    const result = applyFieldMapping(
      { labels: "[infra, urgent" },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual(["[infra", "urgent"]);
  });

  it("returns undefined for tags when the mapped path does not exist", () => {
    const result = applyFieldMapping({}, { tags: "labels.missing" }, "src");
    expect(result.tags).toBeUndefined();
  });

  it("returns undefined for tags when the mapped path traverses a prototype key", () => {
    const result = applyFieldMapping({}, { tags: "__proto__.polluted" }, "src");
    expect(result.tags).toBeUndefined();
  });

  it("drops non-string entries from a JSON-encoded array of numbers, matching the array rule", () => {
    const result = applyFieldMapping(
      { labels: "[1,2,3]" },
      { tags: "labels" },
      "src",
    );
    expect(result.tags).toEqual([]);
  });
});
