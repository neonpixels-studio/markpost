import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import type { ApiToken } from "../../app/composables/useApiTokens";
import { DEFAULT_TOKEN_EXPIRY_DAYS } from "#shared/utils/tokens";

const STUB_TOKENS: ApiToken[] = [
  {
    id: "uuid-1",
    name: "obsidian-laptop",
    prefix: "mp_live_8f2a",
    createdAt: new Date("2026-04-02T00:00:00.000Z"),
    lastUsedAt: new Date("2026-06-27T00:00:00.000Z"),
    expiresAt: null,
    scopes: null,
  },
  {
    id: "uuid-2",
    name: "home-server",
    prefix: "mp_live_2c71",
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    lastUsedAt: null,
    expiresAt: null,
    scopes: ["records:read", "records:write"],
  },
];

const mockLoadTokens = vi.fn();
const mockMintToken = vi.fn();
const mockRevokeToken = vi.fn();
const mockClearRevealedToken = vi.fn();

const mockTokens = ref<ApiToken[]>([]);
const mockIsLoading = ref(false);
const mockLoadError = ref<string | null>(null);
const mockIsMinting = ref(false);
const mockMintError = ref<string | null>(null);
const mockIsRevoking = ref(false);
const mockRevokeError = ref<string | null>(null);
const mockRevealedToken = ref("");
const mockRevealedTokenExpiresAt = ref<Date | null>(null);

vi.stubGlobal("useApiTokens", () => ({
  tokens: mockTokens,
  isLoading: mockIsLoading,
  loadError: mockLoadError,
  isMinting: mockIsMinting,
  mintError: mockMintError,
  isRevoking: mockIsRevoking,
  revokeError: mockRevokeError,
  revealedToken: mockRevealedToken,
  revealedTokenExpiresAt: mockRevealedTokenExpiresAt,
  loadTokens: mockLoadTokens,
  mintToken: mockMintToken,
  revokeToken: mockRevokeToken,
  clearRevealedToken: mockClearRevealedToken,
}));

const globalConfig = {
  global: {
    stubs: {
      SetHead: true,
      AppAlert: {
        template:
          '<div class="app-alert" :data-tone="tone"><div class="a-title">{{ title }}</div><slot /><button v-if="closeable" class="alert-close" @click="$emit(\'close\')" /></div>',
        props: ["tone", "title", "closeable"],
        emits: ["close"],
      },
      AppBtn: {
        template:
          '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        props: ["variant", "size", "icon", "disabled"],
        emits: ["click"],
      },
      AppCopyBtn: { template: '<button class="copy-btn" />' },
      AppIcon: { template: '<span class="stub-icon" />' },
    },
  },
};

beforeEach(() => {
  mockLoadTokens.mockReset().mockResolvedValue(undefined);
  mockMintToken.mockReset().mockResolvedValue(undefined);
  mockRevokeToken.mockReset().mockResolvedValue(undefined);
  mockClearRevealedToken.mockReset();

  mockTokens.value = [];
  mockIsLoading.value = false;
  mockLoadError.value = null;
  mockIsMinting.value = false;
  mockMintError.value = null;
  mockIsRevoking.value = false;
  mockRevokeError.value = null;
  mockRevealedToken.value = "";
  mockRevealedTokenExpiresAt.value = null;
});

describe("SetTokens", () => {
  it("matches snapshot with no tokens loaded", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with tokens loaded", async () => {
    mockTokens.value = STUB_TOKENS;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in loading state", async () => {
    mockIsLoading.value = true;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("calls loadTokens on mount", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    mount(SetTokens, globalConfig);
    await flushPromises();
    expect(mockLoadTokens).toHaveBeenCalledOnce();
  });

  it("renders the token count from the tokens list", async () => {
    mockTokens.value = STUB_TOKENS;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("2 active tokens");
  });

  it("excludes expired-but-unrevoked tokens from the active token count", async () => {
    mockTokens.value = [
      STUB_TOKENS[0],
      {
        ...STUB_TOKENS[1],
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("1 active tokens");
    // Both rows still render — an expired token stays visible so it can be
    // cleaned up, only the header count treats it as inactive.
    expect(wrapper.html()).toContain("obsidian-laptop");
    expect(wrapper.html()).toContain("home-server");
  });

  it("renders each token name and prefix", async () => {
    mockTokens.value = STUB_TOKENS;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("obsidian-laptop");
    expect(wrapper.html()).toContain("mp_live_8f2a");
    expect(wrapper.html()).toContain("home-server");
    expect(wrapper.html()).toContain("mp_live_2c71");
  });

  it("shows 'never' for a token with null lastUsedAt", async () => {
    mockTokens.value = [STUB_TOKENS[1]];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("never");
  });

  it("shows loading text when isLoading is true", async () => {
    mockIsLoading.value = true;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("loading…");
  });

  it("shows load error when loadError is set", async () => {
    mockLoadError.value = "Failed to load tokens.";
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("Failed to load tokens.");
  });

  it("shows mint error when mintError is set", async () => {
    mockMintError.value = "Server error.";
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("Server error.");
  });

  it("clicking retry calls loadTokens again", async () => {
    mockLoadError.value = "Failed to load tokens.";
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const retryButton = buttons.find((button) =>
      button.text().includes("retry"),
    );
    await retryButton?.trigger("click");

    expect(mockLoadTokens).toHaveBeenCalledTimes(2);
  });

  it("shows inline name form after clicking generate token", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const generateButton = buttons.find((button) =>
      button.text().includes("generate token"),
    );
    await generateButton?.trigger("click");

    expect(wrapper.find("input.input").exists()).toBe(true);
    expect(wrapper.html()).toContain("Token name");
  });

  it("calls mintToken with the entered name and no expiry once expiry is unchecked", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    await wrapper.find("input.input").setValue("my-new-token");
    // Expiry defaults to checked (opt-out) — uncheck it to isolate this test
    // to the name-passing behavior, independent of the expiry default.
    await wrapper.find("input[type='checkbox']").setValue(false);

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).toHaveBeenCalledWith(
      "my-new-token",
      undefined,
      undefined,
    );
  });

  it("calls mintToken with the default 90-day expiry when the generate form is confirmed unchanged", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    await wrapper.find("input.input").setValue("my-new-token");

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).toHaveBeenCalledWith(
      "my-new-token",
      DEFAULT_TOKEN_EXPIRY_DAYS,
      undefined,
    );
  });

  it("does not call mintToken when name is blank", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).not.toHaveBeenCalled();
  });

  it("hides the name form when cancel is clicked", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    expect(wrapper.find("input.input").exists()).toBe(true);

    const cancelButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("cancel"));
    await cancelButton?.trigger("click");

    expect(wrapper.find("input.input").exists()).toBe(false);
  });

  it("re-checks expiry by default when the form is reopened after cancelling with it unchecked", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const findGenerateButton = () =>
      wrapper
        .findAll("button")
        .find((button) => button.text().includes("generate token"));
    const findCancelButton = () =>
      wrapper
        .findAll("button")
        .find((button) => button.text().includes("cancel"));

    await findGenerateButton()?.trigger("click");
    await wrapper.find("input[type='checkbox']").setValue(false);
    await findCancelButton()?.trigger("click");

    await findGenerateButton()?.trigger("click");

    const checkbox = wrapper.find("input[type='checkbox']")
      .element as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(wrapper.find("input[type='number']").exists()).toBe(true);
  });

  it("shows the revealed token alert when revealedToken is set", async () => {
    mockRevealedToken.value = "mp_live_abc123"; // gitleaks:allow
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("mp_live_abc123");
    expect(wrapper.html()).toContain("Copy your new token now");
  });

  it("shows 'no expiry' in the reveal panel when the minted token has no expiry", async () => {
    mockRevealedToken.value = "mp_live_abc123"; // gitleaks:allow
    mockRevealedTokenExpiresAt.value = null;
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("no expiry");
  });

  it("shows the remaining lifetime in the reveal panel when the minted token expires", async () => {
    mockRevealedToken.value = "mp_live_abc123"; // gitleaks:allow
    mockRevealedTokenExpiresAt.value = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    );
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("expires in 5 days");
  });

  it("calls clearRevealedToken when the token alert close event fires", async () => {
    mockRevealedToken.value = "mp_live_abc123"; // gitleaks:allow
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const closeButton = wrapper.find(".alert-close");
    await closeButton.trigger("click");

    expect(mockClearRevealedToken).toHaveBeenCalledOnce();
  });

  it("calls revokeToken with the token id when trash button is clicked", async () => {
    mockTokens.value = [STUB_TOKENS[0]];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const trashButton = wrapper.find("button[title='revoke']");
    await trashButton.trigger("click");

    expect(mockRevokeToken).toHaveBeenCalledWith("uuid-1");
  });

  it("keeps the generate form open when mintToken sets mintError", async () => {
    mockMintToken.mockImplementation(async () => {
      mockMintError.value = "Server error.";
    });

    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");
    await wrapper.find("input.input").setValue("my-token");

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(wrapper.find("input.input").exists()).toBe(true);
  });

  it("shows the expiry input by default and hides it once 'expire this token' is unchecked", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    const checkbox = wrapper.find("input[type='checkbox']")
      .element as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(wrapper.find("input[type='number']").exists()).toBe(true);

    await wrapper.find("input[type='checkbox']").setValue(false);

    expect(wrapper.find("input[type='number']").exists()).toBe(false);

    // Re-checking within the same open form must restore the days input,
    // still prefilled with the shared default — covers the false -> true
    // leg of the v-model round-trip, not just the initial default and the
    // true -> false uncheck.
    await wrapper.find("input[type='checkbox']").setValue(true);

    expect(wrapper.find("input[type='number']").exists()).toBe(true);
    expect(
      (wrapper.find("input[type='number']").element as HTMLInputElement).value,
    ).toBe(String(DEFAULT_TOKEN_EXPIRY_DAYS));
  });

  it("passes the entered expiresInDays to mintToken (expiry checked by default)", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    await wrapper.find("input.input").setValue("expiring-token");
    await wrapper.find("input[type='number']").setValue(30);

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).toHaveBeenCalledWith("expiring-token", 30, undefined);
  });

  it("does not call mintToken when the (default-checked) days field is cleared", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    await wrapper.find("input.input").setValue("expiring-token");
    await wrapper.find("input[type='number']").setValue("");

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).not.toHaveBeenCalled();
  });

  it("does not call mintToken when the days field exceeds the maximum bound", async () => {
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();

    const generateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("generate token"));
    await generateButton?.trigger("click");

    await wrapper.find("input.input").setValue("expiring-token");
    await wrapper.find("input[type='number']").setValue(3651);

    const confirmButton = wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "generate" || button.text() === "generating…",
      );
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(mockMintToken).not.toHaveBeenCalled();
  });

  it("shows 'no expiry' for a token with a null expiresAt", async () => {
    mockTokens.value = [STUB_TOKENS[0]];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("no expiry");
  });

  it("shows remaining days for a token with a future expiresAt", async () => {
    mockTokens.value = [
      {
        ...STUB_TOKENS[0],
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    ];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("expires in 5 days");
  });

  it("shows 'expired' for a token with a past expiresAt", async () => {
    mockTokens.value = [
      {
        ...STUB_TOKENS[0],
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ];
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("expired");
  });

  it("shows revokeError when revokeError is set", async () => {
    mockRevokeError.value = "Failed to revoke token.";
    const SetTokens = (
      await import("../../app/components/settings/SetTokens.vue")
    ).default;
    const wrapper = mount(SetTokens, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toContain("Failed to revoke token.");
    expect(wrapper.html()).toContain("Failed to revoke token");
  });

  describe("scopes", () => {
    // The "restrict to specific scopes" checkbox and each per-scope
    // InputCheckbox all render a <label> wrapping their <input>, so finding
    // by the label's own text uniquely locates each one regardless of
    // render order.
    function findCheckboxByLabelText(wrapper: VueWrapper, text: string) {
      const label = wrapper
        .findAll("label")
        .find((candidate) => candidate.text().includes(text));
      return label?.find("input[type='checkbox']");
    }

    it("shows a 'full access' chip for a token with null scopes", async () => {
      mockTokens.value = [STUB_TOKENS[0]];
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();
      expect(wrapper.html()).toContain("full access");
    });

    it("shows a chip per scope for a token with a scoped list", async () => {
      mockTokens.value = [STUB_TOKENS[1]];
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();
      expect(wrapper.html()).toContain("records:read");
      expect(wrapper.html()).toContain("records:write");
    });

    it("hides the scope checklist until 'restrict to specific scopes' is checked", async () => {
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();

      const generateButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes("generate token"));
      await generateButton?.trigger("click");

      expect(wrapper.html()).not.toContain("tokens:write");

      const restrictCheckbox = findCheckboxByLabelText(
        wrapper,
        "Restrict to specific scopes",
      );
      await restrictCheckbox?.setValue(true);

      expect(wrapper.html()).toContain("tokens:write");
    });

    it("disables generate when scopes are restricted but none are selected", async () => {
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();

      const generateButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes("generate token"));
      await generateButton?.trigger("click");
      await wrapper.find("input.input").setValue("scoped-token");

      const restrictCheckbox = findCheckboxByLabelText(
        wrapper,
        "Restrict to specific scopes",
      );
      await restrictCheckbox?.setValue(true);

      const confirmButton = wrapper
        .findAll("button")
        .find(
          (button) =>
            button.text() === "generate" || button.text() === "generating…",
        );
      await confirmButton?.trigger("click");
      await flushPromises();

      expect(mockMintToken).not.toHaveBeenCalled();
    });

    it("calls mintToken with the selected scopes", async () => {
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();

      const generateButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes("generate token"));
      await generateButton?.trigger("click");
      await wrapper.find("input.input").setValue("scoped-token");

      const restrictCheckbox = findCheckboxByLabelText(
        wrapper,
        "Restrict to specific scopes",
      );
      await restrictCheckbox?.setValue(true);

      const recordsReadCheckbox = findCheckboxByLabelText(
        wrapper,
        "records:read",
      );
      await recordsReadCheckbox?.setValue(true);

      const confirmButton = wrapper
        .findAll("button")
        .find(
          (button) =>
            button.text() === "generate" || button.text() === "generating…",
        );
      await confirmButton?.trigger("click");
      await flushPromises();

      expect(mockMintToken).toHaveBeenCalledWith(
        "scoped-token",
        DEFAULT_TOKEN_EXPIRY_DAYS,
        ["records:read"],
      );
    });

    it("calls mintToken with undefined scopes when full access (the default) is left unchanged", async () => {
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();

      const generateButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes("generate token"));
      await generateButton?.trigger("click");
      await wrapper.find("input.input").setValue("full-access-token");

      const confirmButton = wrapper
        .findAll("button")
        .find(
          (button) =>
            button.text() === "generate" || button.text() === "generating…",
        );
      await confirmButton?.trigger("click");
      await flushPromises();

      expect(mockMintToken).toHaveBeenCalledWith(
        "full-access-token",
        DEFAULT_TOKEN_EXPIRY_DAYS,
        undefined,
      );
    });

    it("resets the scope selection when the generate form is cancelled and reopened", async () => {
      const SetTokens = (
        await import("../../app/components/settings/SetTokens.vue")
      ).default;
      const wrapper = mount(SetTokens, globalConfig);
      await flushPromises();

      const findGenerateButton = () =>
        wrapper
          .findAll("button")
          .find((button) => button.text().includes("generate token"));
      const findCancelButton = () =>
        wrapper
          .findAll("button")
          .find((button) => button.text().includes("cancel"));

      await findGenerateButton()?.trigger("click");
      const restrictCheckbox = findCheckboxByLabelText(
        wrapper,
        "Restrict to specific scopes",
      );
      await restrictCheckbox?.setValue(true);
      await findCancelButton()?.trigger("click");

      await findGenerateButton()?.trigger("click");

      const reopenedRestrictCheckbox = findCheckboxByLabelText(
        wrapper,
        "Restrict to specific scopes",
      )?.element as HTMLInputElement;
      expect(reopenedRestrictCheckbox.checked).toBe(false);
    });
  });
});
