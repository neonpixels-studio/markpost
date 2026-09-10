import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const mockClearError = vi.fn();
vi.stubGlobal("clearError", mockClearError);

import ErrorPage from "../../app/error.vue";

const globalConfig = {
  global: {
    stubs: {
      NuxtLink: {
        template: '<a :href="to"><slot /></a>',
        props: ["to"],
      },
      AppTopo: { template: "<div />" },
      AppLogo: { template: "<span />" },
      AppBtn: {
        template:
          '<a v-if="href" :href="href" class="app-btn"><slot /></a><button v-else class="app-btn" @click="$emit(\'click\')"><slot /></button>',
        props: ["variant", "icon", "href"],
        emits: ["click"],
      },
      AppIcon: { template: "<span />" },
    },
  },
};

describe("error page", () => {
  beforeEach(() => {
    mockClearError.mockClear();
  });

  it("renders the status code and message from a thrown NuxtError", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500, statusMessage: "Internal Server Error" },
      },
    });

    expect(wrapper.text()).toContain("500");
    expect(wrapper.text()).toContain("Internal Server Error");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("falls back to a generic message when the error carries none", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500 },
      },
    });

    expect(wrapper.text()).toContain("unhandled error");
  });

  it("clears the error and redirects home when retrying", async () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500, statusMessage: "Internal Server Error" },
      },
    });

    await wrapper.find("button.app-btn").trigger("click");

    expect(mockClearError).toHaveBeenCalledWith({ redirect: "/" });
  });

  it("links back to home", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 404, statusMessage: "Not Found" },
      },
    });

    const homeLinks = wrapper
      .findAll("a")
      .filter((link) => link.attributes("href") === "/");
    expect(homeLinks.length).toBeGreaterThan(0);
  });
});
