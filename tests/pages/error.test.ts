import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

import ErrorPage from "../../app/error.vue";

const globalConfig = {
  global: {
    stubs: {
      AppErrorScreen: {
        template: `
          <div>
            <span class="code">{{ code }}</span>
            <span class="stroke-color">{{ strokeColor }}</span>
            <span class="terminal-output">{{ terminalOutput }}</span>
            <h1>{{ heading }}</h1>
            <p>{{ lead }}</p>
            <slot />
          </div>
        `,
        props: [
          "seed",
          "code",
          "strokeColor",
          "terminalCommand",
          "terminalOutput",
          "terminalOutputColor",
          "heading",
          "lead",
        ],
      },
      AppBtn: {
        template:
          '<a v-if="href" :href="href" class="app-btn" :data-variant="variant"><slot /></a><button v-else class="app-btn" :data-variant="variant" @click="$emit(\'click\')"><slot /></button>',
        props: ["variant", "icon", "href"],
        emits: ["click"],
      },
    },
  },
};

describe("error page", () => {
  const originalReload = window.location.reload;

  beforeEach(() => {
    window.location.reload = vi.fn();
  });

  afterEach(() => {
    window.location.reload = originalReload;
  });

  it("shows the server-error copy and status message for a 500", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500, statusMessage: "Internal Server Error" },
      },
    });

    expect(wrapper.find(".code").text()).toBe("500");
    expect(wrapper.find(".stroke-color").text()).toBe("var(--err)");
    expect(wrapper.find(".terminal-output").text()).toBe(
      "Internal Server Error",
    );
    expect(wrapper.text()).toContain("Something went wrong.");
  });

  it("shows the client-error copy and status message for a 4xx", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 404, statusMessage: "Not Found" },
      },
    });

    expect(wrapper.find(".code").text()).toBe("404");
    expect(wrapper.find(".stroke-color").text()).toBe("var(--accent)");
    expect(wrapper.find(".terminal-output").text()).toBe("Not Found");
    expect(wrapper.text()).toContain("That request didn't work.");
  });

  it("falls back to a generic status message when a 500 carries no statusMessage", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500 },
      },
    });

    expect(wrapper.find(".terminal-output").text()).toBe("internal error");
  });

  it("falls back to a generic status message when a 4xx carries no statusMessage", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 400 },
      },
    });

    expect(wrapper.find(".terminal-output").text()).toBe("unhandled error");
  });

  it("never renders error.message, which can carry internal detail even on a 4xx", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: {
          statusCode: 404,
          message: '[GET] "/api/internal/records/9": 404 Not Found',
        },
      },
    });

    expect(wrapper.find(".terminal-output").text()).toBe("unhandled error");
    expect(wrapper.text()).not.toContain("/api/internal/records/9");
  });

  it("offers retry, as the primary action, only for a 5xx", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500, statusMessage: "Internal Server Error" },
      },
    });

    const retryButton = wrapper.find("button.app-btn");
    expect(retryButton.exists()).toBe(true);
    expect(retryButton.attributes("data-variant")).toBe("accent");

    const homeLink = wrapper.find("a.app-btn[href='/']");
    expect(homeLink.attributes("data-variant")).toBe("");
  });

  it("hides retry and makes home the primary action for a 4xx, since reloading repeats the same error", () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 404, statusMessage: "Not Found" },
      },
    });

    expect(wrapper.find("button.app-btn").exists()).toBe(false);

    const homeLink = wrapper.find("a.app-btn[href='/']");
    expect(homeLink.exists()).toBe(true);
    expect(homeLink.attributes("data-variant")).toBe("accent");
  });

  it("reloads the current page when retrying, rather than redirecting home", async () => {
    const wrapper = mount(ErrorPage, {
      ...globalConfig,
      props: {
        error: { statusCode: 500, statusMessage: "Internal Server Error" },
      },
    });

    await wrapper.find("button.app-btn").trigger("click");

    expect(window.location.reload).toHaveBeenCalled();
  });
});
