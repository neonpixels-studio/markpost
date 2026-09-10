import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("onMounted", (fn: () => void) => fn());

const mockLoadSources = vi.fn();
const mockAddSource = vi.fn();
const mockRemoveSource = vi.fn();
const mockRotateSecret = vi.fn();
const mockUpdateFieldMapping = vi.fn();

const sourcesRef = ref<object[]>([]);
const isLoadingRef = ref(false);

vi.mock("../../app/composables/useSources", () => ({
  useSources: () => ({
    sources: sourcesRef,
    isLoading: isLoadingRef,
    loadSources: mockLoadSources,
    addSource: mockAddSource,
    removeSource: mockRemoveSource,
    rotateSecret: mockRotateSecret,
    updateFieldMapping: mockUpdateFieldMapping,
  }),
  buildEndpointUrl: (type: string, slug: string) => {
    if (type === "email") {
      return `${slug}@in.markpost.io`;
    }
    return `https://ingest.markpost.io/v1/hooks/${slug}`;
  },
  buildSourceMeta: () => ["0 records", "never hit", "routes to 99-incoming/"],
}));

import SourcesPage from "../../app/pages/sources.vue";

const globalConfig = {
  global: {
    stubs: {
      TheAppShell: { template: '<div><slot name="actions" /><slot /></div>' },
      AppAlert: {
        template: '<div class="app-alert"><slot /></div>',
        props: ["tone", "title", "closeable"],
        emits: ["close"],
      },
      AppBtn: {
        template: "<button @click=\"$emit('click')\"><slot /></button>",
        emits: ["click"],
      },
      AppIcon: { template: "<span />" },
      SourceCard: {
        template:
          '<div class="source-card" @click="$emit(\'remove\', source.attributes.uuid)"><button class="rotate-trigger" @click.stop="$emit(\'rotate\', source.attributes.uuid)" /><button class="mapping-trigger" @click.stop="$emit(\'configure-mapping\', source.attributes.uuid)" /></div>',
        props: ["source"],
        emits: ["remove", "rotate", "configure-mapping"],
      },
      AddSourceModal: {
        template: '<div class="add-source-modal" />',
        props: ["modalState", "submitting"],
        emits: ["close", "pick", "add"],
      },
      ConfirmDialog: {
        template:
          '<div class="confirm-dialog"><button class="confirm-btn" @click="$emit(\'confirm\')" /><button class="cancel-btn" @click="$emit(\'cancel\')" /></div>',
        props: ["title", "message", "confirmLabel"],
        emits: ["confirm", "cancel"],
      },
      RotateSecretModal: {
        template:
          '<div class="rotate-modal"><button class="rotate-confirm" @click="$emit(\'rotate\', undefined)" /><button class="rotate-confirm-secret" @click="$emit(\'rotate\', \'whsec_new\')" /><button class="rotate-close" @click="$emit(\'close\')" /></div>',
        props: ["rotateState", "submitting", "error"],
        emits: ["close", "rotate"],
      },
      FieldMappingModal: {
        template:
          '<div class="mapping-modal"><button class="mapping-save" @click="$emit(\'save\', { title: \'data.subject\' })" /><button class="mapping-save-null" @click="$emit(\'save\', null)" /><button class="mapping-close" @click="$emit(\'close\')" /></div>',
        props: ["fieldMappingState", "submitting", "error"],
        emits: ["close", "save"],
      },
    },
  },
};

function makeSource(id = "uuid-1") {
  return {
    type: "sources" as const,
    id,
    attributes: {
      uuid: id,
      userId: "user-1",
      createdAt: "2025-01-01T00:00:00Z",
      type: "webhook",
      name: "Webhook endpoint",
      provider: null,
      providerSecret: null as string | null,
      endpointSlug: "wh_abc12345",
      routeFolder: "99-incoming/",
      fieldMapping: null,
      lastHitAt: null,
      recordCount: 0,
    },
    links: { self: `/api/sources/${id}` },
  };
}

describe("sources page", () => {
  beforeEach(() => {
    sourcesRef.value = [];
    isLoadingRef.value = false;
    mockLoadSources.mockReset();
    mockAddSource.mockReset();
    mockRemoveSource.mockReset();
    mockRotateSecret.mockReset();
    mockUpdateFieldMapping.mockReset();
  });

  it("calls loadSources on mount", () => {
    mount(SourcesPage, globalConfig);
    expect(mockLoadSources).toHaveBeenCalledOnce();
  });

  it("matches snapshot in loading state", () => {
    isLoadingRef.value = true;
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot when loadSources throws", async () => {
    mockLoadSources.mockRejectedValue(new Error("network error"));
    const wrapper = mount(SourcesPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in empty state", () => {
    sourcesRef.value = [];
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with sources", () => {
    sourcesRef.value = [makeSource("uuid-1"), makeSource("uuid-2")];
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows loading indicator while isLoading is true", () => {
    isLoadingRef.value = true;
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.text()).toContain("loading sources");
  });

  it("shows load error alert when loadSources throws", async () => {
    mockLoadSources.mockRejectedValue(new Error("network error"));
    const wrapper = mount(SourcesPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-alert").exists()).toBe(true);
  });

  it("does not hide sources list when remove fails", async () => {
    sourcesRef.value = [makeSource("uuid-1")];
    mockRemoveSource.mockRejectedValue(new Error("delete failed"));
    const wrapper = mount(SourcesPage, globalConfig);
    await wrapper.find(".source-card").trigger("click");
    await wrapper.find(".confirm-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".source-card").exists()).toBe(true);
    expect(wrapper.find(".app-alert").exists()).toBe(true);
  });

  it("shows empty state when sources array is empty", () => {
    sourcesRef.value = [];
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.text()).toContain("No sources yet");
  });

  it("renders a SourceCard for each source", () => {
    sourcesRef.value = [
      makeSource("uuid-1"),
      makeSource("uuid-2"),
      makeSource("uuid-3"),
    ];
    const wrapper = mount(SourcesPage, globalConfig);
    expect(wrapper.findAll(".source-card")).toHaveLength(3);
  });

  it("opens modal when 'add source' button is clicked", async () => {
    const wrapper = mount(SourcesPage, globalConfig);
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".add-source-modal").exists()).toBe(true);
  });

  it("shows confirm dialog when remove is requested from a SourceCard", async () => {
    sourcesRef.value = [makeSource("uuid-1")];
    const wrapper = mount(SourcesPage, globalConfig);
    await wrapper.find(".source-card").trigger("click");
    expect(wrapper.find(".confirm-dialog").exists()).toBe(true);
  });

  it("calls removeSource with the source uuid when confirm dialog is confirmed", async () => {
    sourcesRef.value = [makeSource("uuid-1")];
    mockRemoveSource.mockResolvedValue(undefined);
    const wrapper = mount(SourcesPage, globalConfig);
    await wrapper.find(".source-card").trigger("click");
    await wrapper.find(".confirm-btn").trigger("click");
    await flushPromises();
    expect(mockRemoveSource).toHaveBeenCalledWith("uuid-1");
  });

  it("dismisses confirm dialog without removing when cancel is clicked", async () => {
    sourcesRef.value = [makeSource("uuid-1")];
    const wrapper = mount(SourcesPage, globalConfig);
    await wrapper.find(".source-card").trigger("click");
    await wrapper.find(".cancel-btn").trigger("click");
    expect(mockRemoveSource).not.toHaveBeenCalled();
    expect(wrapper.find(".confirm-dialog").exists()).toBe(false);
  });

  describe("rotate secret flow", () => {
    function makeProviderSource(provider = "github", id = "uuid-gh") {
      const source = makeSource(id);
      source.attributes.type = provider;
      source.attributes.provider = provider;
      source.attributes.name = "GitHub";
      return source;
    }

    it("opens the rotate modal when a provider-backed card requests rotation", async () => {
      sourcesRef.value = [makeProviderSource()];
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".rotate-trigger").trigger("click");
      expect(wrapper.find(".rotate-modal").exists()).toBe(true);
    });

    it("does not open the rotate modal for a source with no provider", async () => {
      sourcesRef.value = [makeSource("uuid-plain")];
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".rotate-trigger").trigger("click");
      expect(wrapper.find(".rotate-modal").exists()).toBe(false);
    });

    it("calls rotateSecret with the source uuid when the modal confirms", async () => {
      sourcesRef.value = [makeProviderSource()];
      mockRotateSecret.mockResolvedValue(makeProviderSource());
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".rotate-trigger").trigger("click");
      await wrapper.find(".rotate-confirm").trigger("click");
      await flushPromises();
      expect(mockRotateSecret).toHaveBeenCalledWith("uuid-gh", undefined);
    });

    it("moves to the reveal step when the rotated source carries a new secret", async () => {
      sourcesRef.value = [makeProviderSource()];
      const rotated = makeProviderSource();
      rotated.attributes.providerSecret = "fresh-generated-secret";
      mockRotateSecret.mockResolvedValue(rotated);
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      const modal = wrapper.findComponent(".rotate-modal");
      await wrapper.find(".rotate-confirm").trigger("click");
      await flushPromises();

      expect(modal.props("rotateState")).toMatchObject({
        step: "reveal",
        revealSecret: "fresh-generated-secret",
      });
    });

    it("passes a manual secret through to rotateSecret", async () => {
      sourcesRef.value = [makeProviderSource("stripe", "uuid-stripe")];
      mockRotateSecret.mockResolvedValue(
        makeProviderSource("stripe", "uuid-stripe"),
      );
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".rotate-trigger").trigger("click");
      await wrapper.find(".rotate-confirm-secret").trigger("click");
      await flushPromises();
      expect(mockRotateSecret).toHaveBeenCalledWith("uuid-stripe", "whsec_new");
    });

    it("surfaces an error instead of a false success when a generated provider reveals nothing", async () => {
      sourcesRef.value = [makeProviderSource()];
      const rotated = makeProviderSource();
      rotated.attributes.providerSecret = null;
      mockRotateSecret.mockResolvedValue(rotated);
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      const modal = wrapper.findComponent(".rotate-modal");
      await wrapper.find(".rotate-confirm").trigger("click");
      await flushPromises();

      // Stays on confirm (never reveal/done) with the error shown inline.
      expect(modal.props("rotateState")).toMatchObject({ step: "confirm" });
      expect(modal.props("error")).toContain("new value was not returned");
    });

    it("moves to the done step when the rotation reveals nothing (manual provider)", async () => {
      sourcesRef.value = [makeProviderSource("stripe", "uuid-stripe")];
      const rotated = makeProviderSource("stripe", "uuid-stripe");
      rotated.attributes.providerSecret = null;
      mockRotateSecret.mockResolvedValue(rotated);
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      const modal = wrapper.findComponent(".rotate-modal");
      await wrapper.find(".rotate-confirm").trigger("click");
      await flushPromises();

      expect(modal.props("rotateState")).toMatchObject({ step: "done" });
    });

    it("keeps the modal open and routes the failure into the modal's error prop", async () => {
      // Mirrors addSource: a transient failure must not tear down the modal, or
      // a manual-secret provider loses the value the user just pasted. The error
      // goes into the modal (not a page banner the modal's scrim would bury).
      sourcesRef.value = [makeProviderSource()];
      mockRotateSecret.mockRejectedValue(new Error("rotate failed"));
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      const modal = wrapper.findComponent(".rotate-modal");
      await wrapper.find(".rotate-confirm").trigger("click");
      await flushPromises();

      expect(wrapper.find(".rotate-modal").exists()).toBe(true);
      expect(modal.props("error")).toContain("Failed to rotate secret");
    });

    it("ignores a close emitted while a rotation is in flight, still reaching the reveal step", async () => {
      sourcesRef.value = [makeProviderSource()];
      const rotated = makeProviderSource();
      rotated.attributes.providerSecret = "fresh-generated-secret";
      let resolveRotate: (value: typeof rotated) => void = () => {};
      mockRotateSecret.mockReturnValue(
        new Promise((resolve) => {
          resolveRotate = resolve;
        }),
      );
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      const modal = wrapper.findComponent(".rotate-modal");
      wrapper.find(".rotate-confirm").trigger("click");
      await Promise.resolve();

      // A stray close mid-flight must be a no-op — the server may already have
      // rotated, so dropping the modal would strip the unrevealed new secret.
      await wrapper.find(".rotate-close").trigger("click");
      expect(wrapper.find(".rotate-modal").exists()).toBe(true);

      resolveRotate(rotated);
      await flushPromises();

      expect(modal.props("rotateState")).toMatchObject({
        step: "reveal",
        revealSecret: "fresh-generated-secret",
      });
    });

    it("closes the modal on a close emitted when no rotation is in flight", async () => {
      sourcesRef.value = [makeProviderSource()];
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find(".rotate-trigger").trigger("click");
      expect(wrapper.find(".rotate-modal").exists()).toBe(true);

      await wrapper.find(".rotate-close").trigger("click");
      expect(wrapper.find(".rotate-modal").exists()).toBe(false);
    });
  });

  describe("field mapping flow", () => {
    it("opens the mapping modal when a card requests it", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      expect(wrapper.find(".mapping-modal").exists()).toBe(true);
    });

    it("does not open the mapping modal if the source is no longer in the list by the time the request is handled", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      const wrapper = mount(SourcesPage, globalConfig);
      const trigger = wrapper.find(".mapping-trigger");
      // Simulate the source vanishing (a concurrent loadSources/delete)
      // between render and the click being handled.
      sourcesRef.value = [];
      await trigger.trigger("click");
      expect(wrapper.find(".mapping-modal").exists()).toBe(false);
    });

    it("calls updateFieldMapping with the source uuid and built mapping when saved", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      mockUpdateFieldMapping.mockResolvedValue(makeSource("uuid-1"));
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      await wrapper.find(".mapping-save").trigger("click");
      await flushPromises();
      expect(mockUpdateFieldMapping).toHaveBeenCalledWith("uuid-1", {
        title: "data.subject",
      });
    });

    it("calls updateFieldMapping with null when the mapping is cleared", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      mockUpdateFieldMapping.mockResolvedValue(makeSource("uuid-1"));
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      await wrapper.find(".mapping-save-null").trigger("click");
      await flushPromises();
      expect(mockUpdateFieldMapping).toHaveBeenCalledWith("uuid-1", null);
    });

    it("closes the modal after a successful save", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      mockUpdateFieldMapping.mockResolvedValue(makeSource("uuid-1"));
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      await wrapper.find(".mapping-save").trigger("click");
      await flushPromises();
      expect(wrapper.find(".mapping-modal").exists()).toBe(false);
    });

    it("keeps the modal open and routes a save failure into the modal's error prop", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      mockUpdateFieldMapping.mockRejectedValue(new Error("update failed"));
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      const modal = wrapper.findComponent(".mapping-modal");
      await wrapper.find(".mapping-save").trigger("click");
      await flushPromises();

      expect(wrapper.find(".mapping-modal").exists()).toBe(true);
      expect(modal.props("error")).toContain("Failed to save field mapping");
    });

    it("closes the modal on a close emitted when no save is in flight", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      expect(wrapper.find(".mapping-modal").exists()).toBe(true);
      await wrapper.find(".mapping-close").trigger("click");
      expect(wrapper.find(".mapping-modal").exists()).toBe(false);
    });

    it("ignores a close emitted while a save is in flight", async () => {
      sourcesRef.value = [makeSource("uuid-1")];
      let resolveSave: (
        value: ReturnType<typeof makeSource>,
      ) => void = () => {};
      mockUpdateFieldMapping.mockReturnValue(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      );
      const wrapper = mount(SourcesPage, globalConfig);
      await wrapper.find(".mapping-trigger").trigger("click");
      wrapper.find(".mapping-save").trigger("click");
      await Promise.resolve();

      await wrapper.find(".mapping-close").trigger("click");
      expect(wrapper.find(".mapping-modal").exists()).toBe(true);

      resolveSave(makeSource("uuid-1"));
      await flushPromises();
      expect(wrapper.find(".mapping-modal").exists()).toBe(false);
    });
  });

  describe("addSource reveal step", () => {
    async function openModalAndPickGithub(wrapper: VueWrapper) {
      await wrapper.find("button").trigger("click");
      const modal = wrapper.findComponent(".add-source-modal");
      await modal.vm.$emit("pick", { id: "github", name: "GitHub" });
    }

    it("closes the modal when the created source has no providerSecret", async () => {
      mockAddSource.mockResolvedValue(makeSource("uuid-new"));
      const wrapper = mount(SourcesPage, globalConfig);

      await openModalAndPickGithub(wrapper);
      const modal = wrapper.findComponent(".add-source-modal");
      await modal.vm.$emit("add", "99-incoming/");
      await flushPromises();

      expect(wrapper.find(".add-source-modal").exists()).toBe(false);
    });

    it("keeps the modal open in the reveal step when the created source has a providerSecret", async () => {
      const created = makeSource("uuid-new");
      created.attributes.providerSecret = "generated-secret-value";
      mockAddSource.mockResolvedValue(created);
      const wrapper = mount(SourcesPage, globalConfig);

      await openModalAndPickGithub(wrapper);
      const modal = wrapper.findComponent(".add-source-modal");
      await modal.vm.$emit("add", "99-incoming/");
      await flushPromises();

      expect(wrapper.find(".add-source-modal").exists()).toBe(true);
      expect(modal.props("modalState")).toMatchObject({
        step: "reveal",
        revealSecret: "generated-secret-value",
      });
    });

    it("closes the modal for a manual-secret preset (stripe) even if the response carried a providerSecret", async () => {
      // The server never echoes a manual-secret provider's value back (see
      // computeProviderSecretPlan's revealSecret: null for stripe), but the
      // page's own `choice.secretEntry === "manual"` check is a second,
      // independent guard against ever re-displaying it — pinned here in
      // case the response ever carried one anyway.
      const created = makeSource("uuid-new");
      created.attributes.providerSecret = "whsec_user_supplied_secret";
      mockAddSource.mockResolvedValue(created);
      const wrapper = mount(SourcesPage, globalConfig);

      await wrapper.find("button").trigger("click");
      const modal = wrapper.findComponent(".add-source-modal");
      await modal.vm.$emit("pick", {
        id: "stripe",
        name: "Stripe",
        secretEntry: "manual",
      });
      await modal.vm.$emit("add", "99-incoming/", "whsec_user_supplied_secret");
      await flushPromises();

      expect(wrapper.find(".add-source-modal").exists()).toBe(false);
    });

    it("passes submitting=true to the modal while the create request is in flight, and false once it settles", async () => {
      // Use a created source WITH a providerSecret so the modal stays mounted
      // (reveal step) after the request settles — a source with none closes
      // the modal entirely, which would make the second prop read stale.
      let resolveCreate: (
        value: ReturnType<typeof makeSource>,
      ) => void = () => {};
      mockAddSource.mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
      );
      const wrapper = mount(SourcesPage, globalConfig);

      await openModalAndPickGithub(wrapper);
      const modal = wrapper.findComponent(".add-source-modal");
      modal.vm.$emit("add", "99-incoming/");
      await Promise.resolve();

      expect(modal.props("submitting")).toBe(true);

      const created = makeSource("uuid-new");
      created.attributes.providerSecret = "generated-secret-value";
      resolveCreate(created);
      await flushPromises();

      expect(modal.props("submitting")).toBe(false);
    });
  });
});
