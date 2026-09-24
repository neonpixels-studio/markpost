import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TokenScopeFields from "../../app/components/settings/TokenScopeFields.vue";
import { SCOPE_NAMES } from "#shared/utils/scopes";

describe("TokenScopeFields", () => {
  it("defaults wantsScopes to false (unchecked/full access) when the prop is omitted", () => {
    const wrapper = mount(TokenScopeFields);

    const checkbox = wrapper.find("input[type='checkbox']")
      .element as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(wrapper.html()).toContain("full access to every resource");
  });

  it("matches snapshot when scopes are not restricted", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: false, scopes: [] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot when scopes are restricted", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: true, scopes: ["records:read"] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("hides the scope checklist when wantsScopes is false", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: false, scopes: [] },
    });
    expect(wrapper.findAll("input[type='checkbox']")).toHaveLength(1);
  });

  it("renders one checkbox per catalog scope when wantsScopes is true", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: true, scopes: [] },
    });
    // +1 for the "restrict to specific scopes" toggle itself.
    expect(wrapper.findAll("input[type='checkbox']")).toHaveLength(
      SCOPE_NAMES.length + 1,
    );

    for (const scopeName of SCOPE_NAMES) {
      expect(wrapper.html()).toContain(scopeName);
    }
  });

  it("emits update:wantsScopes when the toggle is checked", async () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: false, scopes: [] },
    });

    await wrapper.find("input[type='checkbox']").setValue(true);

    expect(wrapper.emitted("update:wantsScopes")).toEqual([[true]]);
  });

  it("checks the box for each scope already in the scopes prop", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: true, scopes: ["records:read", "events:read"] },
    });

    const checkboxes = wrapper.findAll("input[type='checkbox']");
    // Index 0 is the "restrict" toggle; the rest follow SCOPE_NAMES order.
    const recordsReadIndex = SCOPE_NAMES.indexOf("records:read") + 1;
    const eventsReadIndex = SCOPE_NAMES.indexOf("events:read") + 1;
    const recordsWriteIndex = SCOPE_NAMES.indexOf("records:write") + 1;

    expect(
      (checkboxes[recordsReadIndex].element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (checkboxes[eventsReadIndex].element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (checkboxes[recordsWriteIndex].element as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("emits update:scopes with the scope added when an unselected scope is checked", async () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: true, scopes: ["records:read"] },
    });

    const recordsWriteIndex = SCOPE_NAMES.indexOf("records:write") + 1;
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[recordsWriteIndex].setValue(true);

    expect(wrapper.emitted("update:scopes")).toEqual([
      [["records:read", "records:write"]],
    ]);
  });

  it("emits update:scopes with the scope removed when a selected scope is unchecked", async () => {
    const wrapper = mount(TokenScopeFields, {
      props: {
        wantsScopes: true,
        scopes: ["records:read", "records:write"],
      },
    });

    const recordsReadIndex = SCOPE_NAMES.indexOf("records:read") + 1;
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[recordsReadIndex].setValue(false);

    expect(wrapper.emitted("update:scopes")).toEqual([[["records:write"]]]);
  });

  it("disables every checkbox when disabled is true", () => {
    const wrapper = mount(TokenScopeFields, {
      props: { wantsScopes: true, scopes: [], disabled: true },
    });

    const checkboxes = wrapper.findAll("input[type='checkbox']");
    for (const checkbox of checkboxes) {
      expect(checkbox.attributes("disabled")).not.toBeUndefined();
    }
  });
});
