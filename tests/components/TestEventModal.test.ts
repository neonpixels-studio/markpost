import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TestEventModal from "../../app/components/TestEventModal.vue";
import AppIcon from "../../app/components/AppIcon.vue";
import AppAlert from "../../app/components/AppAlert.vue";
import AppField from "../../app/components/AppField.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import InputTextarea from "../../app/components/InputTextarea.vue";
import type { TestEventState } from "../../app/types/testEvent";
import type { TestEventResult } from "../../app/composables/useSources";

const globalConfig = {
  global: {
    components: { AppIcon, AppAlert, AppField, AppBtn, InputTextarea },
  },
};

function makeResult(overrides: Partial<TestEventResult> = {}): TestEventResult {
  return {
    provider: null,
    payload: { title: "Test event from markpost" },
    signatureCheck: {
      status: "not_required",
      message:
        "No provider is configured for this source — deliveries are authenticated by the endpoint's secret URL slug alone.",
    },
    fieldMapping: {
      title: "Test event from markpost",
      content: "This is a test event",
      tags: ["test"],
      frontmatter: {},
      filePath: "99-incoming/2026-01-15-test-event-from-markpost.md",
    },
    ...overrides,
  };
}

function stateFor(
  overrides: Partial<TestEventState> = {},
  result: TestEventResult | null = null,
): TestEventState {
  return {
    source: { uuid: "uuid-1", name: "GitHub" },
    result,
    ...overrides,
  };
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes(label));
}

function payloadTextarea(wrapper: ReturnType<typeof mount>) {
  return wrapper.find("textarea");
}

describe("TestEventModal", () => {
  it("shows the source name in the header", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    expect(wrapper.text()).toContain("GitHub");
    expect(wrapper.text()).toContain("Send test event");
  });

  it("pre-fills the payload editor with the default sample payload", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    expect(
      (payloadTextarea(wrapper).element as HTMLTextAreaElement).value,
    ).toContain("Test event from markpost");
  });

  it("emits send with the parsed JSON payload", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });

    await payloadTextarea(wrapper).setValue('{"title": "hello"}');
    await findButton(wrapper, "send test event")?.trigger("click");

    expect(wrapper.emitted("send")?.[0]).toEqual([{ title: "hello" }]);
  });

  it("disables sending and shows an error for invalid JSON", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });

    await payloadTextarea(wrapper).setValue("not json");

    expect(wrapper.text()).toContain("Payload must be valid JSON");
    const sendButton = findButton(wrapper, "send test event");
    expect(sendButton?.attributes("disabled")).toBeDefined();
    await sendButton?.trigger("click");
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("disables sending for valid JSON that is not an object (e.g. an array)", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });

    await payloadTextarea(wrapper).setValue("[1, 2, 3]");

    const sendButton = findButton(wrapper, "send test event");
    expect(sendButton?.attributes("disabled")).toBeDefined();
  });

  it("shows no result panel before a send completes", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    expect(wrapper.text()).not.toContain("field mapping result");
  });

  it.each([
    ["verified", "ok", "Signature verified"],
    ["failed", "err", "Signature check failed"],
    ["not_verifiable", "warn", "Signature check not verifiable"],
    ["not_required", "info", "No signature required"],
  ] as const)(
    "renders the %s signature status with %s tone and the right title",
    (status, tone, title) => {
      const wrapper = mount(TestEventModal, {
        ...globalConfig,
        props: {
          testEventState: stateFor(
            {},
            makeResult({ signatureCheck: { status, message: "details" } }),
          ),
        },
      });
      const alert = wrapper.findAll(".alert").at(-1);
      expect(alert?.classes()).toContain(tone);
      expect(wrapper.text()).toContain(title);
      expect(wrapper.text()).toContain("details");
    },
  );

  it("shows the field mapping preview once a result is present", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: {
        testEventState: stateFor(
          {},
          makeResult({
            fieldMapping: {
              title: "Mapped title",
              content: "Mapped body",
              tags: ["a", "b"],
              frontmatter: {},
              filePath: "99-incoming/mapped.md",
            },
          }),
        ),
      },
    });
    expect(wrapper.text()).toContain("Mapped title");
    expect(wrapper.text()).toContain("Mapped body");
    expect(wrapper.text()).toContain("a, b");
    expect(wrapper.text()).toContain("99-incoming/mapped.md");
  });

  it("relabels the button to 'send again' once a result exists", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor({}, makeResult()) },
    });
    expect(findButton(wrapper, "send again")).toBeTruthy();
  });

  it("emits close when the close footer button is clicked", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    await findButton(wrapper, "close")?.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close from the backdrop", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    await wrapper.find("div").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not emit close when clicking inside the card", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor() },
    });
    await wrapper.find(".card").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("does not emit close from the backdrop while submitting", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor(), submitting: true },
    });
    await wrapper.find("div").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("hides the header close button while submitting", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor(), submitting: true },
    });
    expect(wrapper.find(".icon-btn").exists()).toBe(false);
  });

  it("disables send and close, and emits nothing, while submitting", async () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: { testEventState: stateFor(), submitting: true },
    });
    const sendButton = findButton(wrapper, "send test event");
    const closeButton = findButton(wrapper, "close");
    expect(sendButton?.attributes("disabled")).toBeDefined();
    expect(closeButton?.attributes("disabled")).toBeDefined();

    await sendButton?.trigger("click");
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("renders a send error inline", () => {
    const wrapper = mount(TestEventModal, {
      ...globalConfig,
      props: {
        testEventState: stateFor(),
        error: "Failed to send test event. Please try again.",
      },
    });
    expect(wrapper.text()).toContain("Test event failed");
    expect(wrapper.text()).toContain("Failed to send test event");
  });
});
