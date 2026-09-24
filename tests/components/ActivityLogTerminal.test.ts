import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ActivityLogTerminal from "../../app/components/ActivityLogTerminal.vue";
import type { LogRow } from "../../app/composables/useEvents";

const sampleRows: LogRow[] = [
  ["09:41:02", "ok", "webhook github:push → 99-incoming/deploy.md"],
  ["09:42:11", "dim", "no-op: nothing changed"],
  ["09:43:05", "warn", "retrying delivery"],
  ["07:48:30", "err", "conflict: file exists, skipped"],
];

describe("ActivityLogTerminal", () => {
  it("matches snapshot", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: sampleRows },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders one row per log entry", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: sampleRows },
    });
    expect(wrapper.text()).toContain("webhook github:push");
    expect(wrapper.text()).toContain("no-op: nothing changed");
    expect(wrapper.text()).toContain("retrying delivery");
    expect(wrapper.text()).toContain("conflict: file exists, skipped");
  });

  it("prefixes an error row with a cross mark and the error color", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: [sampleRows[3]] },
    });
    expect(wrapper.text()).toContain("✗");
    expect(wrapper.html()).toContain("color: var(--err)");
  });

  it("prefixes a warn row with an exclamation mark", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: [sampleRows[2]] },
    });
    expect(wrapper.text()).toContain("!");
  });

  it("prefixes an ok row with a check mark", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: [sampleRows[0]] },
    });
    expect(wrapper.text()).toContain("✓");
  });

  it("renders no icon prefix for a dim row", () => {
    const wrapper = mount(ActivityLogTerminal, {
      props: { log: [sampleRows[1]] },
    });
    expect(wrapper.text()).not.toContain("✓");
    expect(wrapper.text()).not.toContain("✗");
    expect(wrapper.text()).not.toContain("!");
  });
});
