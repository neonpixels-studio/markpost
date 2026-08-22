import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

const vueGlobals = {
  // reactivity
  ref: "readonly",
  reactive: "readonly",
  computed: "readonly",
  readonly: "readonly",
  shallowRef: "readonly",
  shallowReactive: "readonly",
  shallowReadonly: "readonly",
  toRef: "readonly",
  toRefs: "readonly",
  isRef: "readonly",
  unref: "readonly",
  markRaw: "readonly",
  nextTick: "readonly",
  watch: "readonly",
  watchEffect: "readonly",
  // lifecycle
  onMounted: "readonly",
  onUnmounted: "readonly",
  onBeforeMount: "readonly",
  onBeforeUnmount: "readonly",
  onUpdated: "readonly",
  onBeforeUpdate: "readonly",
  onActivated: "readonly",
  onDeactivated: "readonly",
  // composition
  inject: "readonly",
  provide: "readonly",
  useAttrs: "readonly",
  useSlots: "readonly",
  useId: "readonly",
  defineComponent: "readonly",
  h: "readonly",
  resolveComponent: "readonly",
};

const nuxtGlobals = {
  definePageMeta: "readonly",
  defineNuxtConfig: "readonly",
  defineNuxtRouteMiddleware: "readonly",
  defineNuxtPlugin: "readonly",
  useRoute: "readonly",
  useRouter: "readonly",
  useRequestEvent: "readonly",
  setResponseStatus: "readonly",
  useNuxtApp: "readonly",
  useRuntimeConfig: "readonly",
  useHead: "readonly",
  useSeoMeta: "readonly",
  navigateTo: "readonly",
  abortNavigation: "readonly",
  useState: "readonly",
  useFetch: "readonly",
  useLazyFetch: "readonly",
  useAsyncData: "readonly",
  $fetch: "readonly",
};

const piniaGlobals = {
  defineStore: "readonly",
  storeToRefs: "readonly",
};

const clerkGlobals = {
  useAuth: "readonly",
  useUser: "readonly",
  useClerkUser: "readonly",
  useSignIn: "readonly",
  useSignUp: "readonly",
  useSession: "readonly",
  useOrganization: "readonly",
};

const appGlobals = {
  useTheme: "readonly",
  useSettings: "readonly",
  useSyncSettings: "readonly",
  useApiTokens: "readonly",
};

export default [
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  prettier,
  {
    languageOptions: {
      parser: pluginVue.parser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".vue"],
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...vueGlobals,
        ...nuxtGlobals,
        ...piniaGlobals,
        ...clerkGlobals,
        ...appGlobals,
      },
    },
    rules: {
      // TypeScript types already express optionality — defaults would be redundant
      "vue/require-default-prop": "off",
      // Nuxt page files intentionally use single-word names (index, login, etc.)
      "vue/multi-word-component-names": "off",
      // Allow _-prefixed vars used only as destructuring placeholders
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["app/components/AppIcon.vue"],
    rules: {
      "vue/no-v-html": "off",
    },
  },
  {
    ignores: [
      ".netlify/**",
      ".nuxt/**",
      ".output/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
];
