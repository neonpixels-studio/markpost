import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import SourceCard from "../../app/components/SourceCard.vue";
import AppIcon from "../../app/components/AppIcon.vue";
import AppBadge from "../../app/components/AppBadge.vue";
import AppChip from "../../app/components/AppChip.vue";
import AppCopyBtn from "../../app/components/AppCopyBtn.vue";
import type { SourceResource } from "../../app/composables/useSources";

const globalConfig = {
  global: {
    components: { AppIcon, AppBadge, AppChip, AppCopyBtn },
  },
};

function makeSource(
  overrides: Partial<SourceResource["attributes"]> = {},
): SourceResource {
  return {
    type: "sources",
    id: "test-uuid-1",
    attributes: {
      uuid: "test-uuid-1",
      userId: "user-1",
      createdAt: "2025-01-01T00:00:00Z",
      type: "webhook",
      name: "Webhook endpoint",
      provider: null,
      endpointSlug: "wh_abc12345",
      routeFolder: "99-incoming/",
      fieldMapping: null,
      lastHitAt: null,
      recordCount: 42,
      ...overrides,
    },
    links: { self: "/api/sources/test-uuid-1" },
  };
}

describe("SourceCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches snapshot for a webhook source", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource() },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot for an email source", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({
          type: "email",
          name: "Email-in address",
          endpointSlug: "clip-ab12",
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot for a preset (stripe) source", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({
          type: "stripe",
          name: "Stripe",
          endpointSlug: "wh_stripe01",
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders webhook ingest URL for webhook sources", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ type: "webhook", endpointSlug: "wh_abc12345" }),
      },
    });
    expect(wrapper.text()).toContain("https://ingest.markpost.io/v1/hooks/");
    expect(wrapper.text()).toContain("wh_abc12345");
  });

  it("renders email address format for email sources", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ type: "email", endpointSlug: "clip-ab12" }),
      },
    });
    expect(wrapper.text()).toContain("clip-ab12");
    expect(wrapper.text()).toContain("@in.markpost.io");
  });

  it("shows icon letter for preset sources", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ type: "stripe", name: "Stripe" }) },
    });
    expect(wrapper.text()).toContain("S");
  });

  it("shows record count in meta", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ recordCount: 99 }) },
    });
    expect(wrapper.text()).toContain("99 records");
  });

  it("shows 'never hit' when lastHitAt is null", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ lastHitAt: null }) },
    });
    expect(wrapper.text()).toContain("never hit");
  });

  it("shows route folder in meta", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ routeFolder: "work/notes/" }) },
    });
    expect(wrapper.text()).toContain("routes to work/notes/");
  });

  it("emits remove with the source uuid when trash button is clicked", async () => {
    const source = makeSource();
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source },
    });
    await wrapper.find("button[title='Remove source']").trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual(["test-uuid-1"]);
  });

  it.each(["stripe", "github", "zapier", "shortcuts"])(
    "shows a rotate-secret button for provider-backed source %s",
    (provider) => {
      const wrapper = mount(SourceCard, {
        ...globalConfig,
        props: { source: makeSource({ type: provider, provider }) },
      });
      expect(wrapper.find("button[title='Rotate secret']").exists()).toBe(true);
    },
  );

  it("does not show a rotate-secret button for a plain webhook source (no provider)", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource() },
    });
    expect(wrapper.find("button[title='Rotate secret']").exists()).toBe(false);
  });

  it("does not show a rotate-secret button for an email source", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ type: "email", provider: null }) },
    });
    expect(wrapper.find("button[title='Rotate secret']").exists()).toBe(false);
  });

  it("emits rotate with the source uuid when the rotate button is clicked", async () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ type: "github", provider: "github" }),
      },
    });
    await wrapper.find("button[title='Rotate secret']").trigger("click");
    expect(wrapper.emitted("rotate")?.[0]).toEqual(["test-uuid-1"]);
  });

  it("shows 'active' badge when the source delivered recently", () => {
    const recentHit = new Date("2026-01-15T11:00:00Z").toISOString();
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ lastHitAt: recentHit }) },
    });
    expect(wrapper.text()).toContain("active");
  });

  it("shows 'quiet' badge when the source delivered but not recently", () => {
    const staleHit = new Date("2025-12-01T00:00:00Z").toISOString();
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ lastHitAt: staleHit }) },
    });
    expect(wrapper.text()).toContain("quiet");
  });

  it("shows 'idle' badge for an old source that has never delivered", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({
          createdAt: "2025-01-01T00:00:00Z",
          lastHitAt: null,
        }),
      },
    });
    expect(wrapper.text()).toContain("idle");
  });

  it("shows 'ready' badge for a just-created source awaiting its first delivery", () => {
    const recentTime = new Date("2026-01-15T11:56:00Z").toISOString();
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ createdAt: recentTime, lastHitAt: null }),
      },
    });
    expect(wrapper.text()).toContain("ready");
  });

  it("emits remove with attributes.uuid (not source.id) when trash is clicked", async () => {
    const source: SourceResource = {
      type: "sources",
      id: "resource-id",
      attributes: {
        uuid: "attributes-uuid",
        userId: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
        type: "webhook",
        name: "Webhook endpoint",
        provider: null,
        endpointSlug: "wh_abc12345",
        routeFolder: "99-incoming/",
        fieldMapping: null,
        lastHitAt: null,
        recordCount: 0,
      },
      links: { self: "/api/sources/attributes-uuid" },
    };
    const wrapper = mount(SourceCard, { ...globalConfig, props: { source } });
    await wrapper.find("button[title='Remove source']").trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual(["attributes-uuid"]);
  });

  it("never renders a providerSecret, even if the API response happened to include one", () => {
    // The server only ever reveals providerSecret once, in the create response
    // (server/utils/response.ts's revealProviderSecret option); SourceCard reads
    // from the list/patch responses, which always null it out. This pins that
    // SourceCard has no code path that would display it if that ever changed.
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({
          type: "github",
          name: "GitHub",
          provider: "github",
          providerSecret: "abc123secret",
        }),
      },
    });
    expect(wrapper.text()).not.toContain("abc123secret");
    expect(wrapper.text()).not.toContain("copy secret");
  });

  it.each(["zapier", "shortcuts"])(
    "shows an ongoing header-name hint for %s (shared-secret providers)",
    (provider) => {
      const wrapper = mount(SourceCard, {
        ...globalConfig,
        props: { source: makeSource({ type: provider, provider }) },
      });
      expect(wrapper.text()).toContain("x-markpost-secret");
    },
  );

  it("does not show the ongoing hint for github (its instructions reference a value that can't be shown again)", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ type: "github", provider: "github" }),
      },
    });
    expect(wrapper.text()).not.toContain("Paste this into");
  });

  it("does not show the ongoing hint for stripe or plain webhook sources", () => {
    const stripeWrapper = mount(SourceCard, {
      ...globalConfig,
      props: {
        source: makeSource({ type: "stripe", provider: "stripe" }),
      },
    });
    const webhookWrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource() },
    });

    expect(stripeWrapper.text()).not.toContain("x-markpost-secret");
    expect(webhookWrapper.text()).not.toContain("x-markpost-secret");
  });

  it("does not duplicate the slug — endpointSlug appears exactly once in code body", () => {
    const wrapper = mount(SourceCard, {
      ...globalConfig,
      props: { source: makeSource({ endpointSlug: "wh_abc12345" }) },
    });
    const codeBody = wrapper.find(".code-body");
    const text = codeBody.text();
    const firstIndex = text.indexOf("wh_abc12345");
    const lastIndex = text.lastIndexOf("wh_abc12345");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBe(lastIndex);
  });
});
