import { describe, it, expect } from "vitest";
import {
  filenameTemplateViolation,
  FILENAME_TEMPLATE_MAX_LENGTH,
} from "#shared/utils/filenameTemplate";

describe("filenameTemplateViolation", () => {
  const validTemplates = [
    "{{date}}-{{slug}}.md",
    "{{slug}}.md",
    "{{date}}.md",
    "{{source}}/{{slug}}.md",
    "notes/{{date}}-{{slug}}.MD",
  ];

  it.each(validTemplates)("accepts the legitimate template %j", (value) => {
    expect(filenameTemplateViolation(value)).toBeNull();
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(filenameTemplateViolation("")).toBe("empty");
    expect(filenameTemplateViolation("   ")).toBe("empty");
  });

  it("rejects a value longer than the max length", () => {
    const longPrefix = "a".repeat(FILENAME_TEMPLATE_MAX_LENGTH);
    expect(filenameTemplateViolation(`${longPrefix}{{slug}}.md`)).toBe(
      "too-long",
    );
  });

  const constantTemplates = ["notes.md", "inbox/note.md", "a-b-c.md"];

  it.each(constantTemplates)(
    "rejects the placeholder-free template %j",
    (value) => {
      expect(filenameTemplateViolation(value)).toBe("missing-placeholder");
    },
  );

  const missingExtensionTemplates = [
    "{{slug}}",
    "{{date}}-{{slug}}.txt",
    "{{slug}}.markdown",
  ];

  it.each(missingExtensionTemplates)(
    "rejects the non-markdown template %j",
    (value) => {
      expect(filenameTemplateViolation(value)).toBe("missing-extension");
    },
  );
});
