import { vi } from "vitest";
import {
  computed,
  ref,
  reactive,
  watch,
  watchEffect,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
  onScopeDispose,
  nextTick,
  defineComponent,
  defineProps,
  defineEmits,
  withDefaults,
  useAttrs,
  useSlots,
  useId,
} from "vue";
import { useSyncSettings } from "../app/composables/useSyncSettings";
import { useApiTokens } from "../app/composables/useApiTokens";

// server/utils/errorReporting.ts (and everything that imports it, which is
// most of server/*) talks to the real @sentry/nuxt SDK. Without Sentry.init
// in the test process captureException/captureMessage are harmless no-ops
// today, but that's incidental, not guaranteed — mock the module globally so
// the suite never depends on that, and no test accidentally makes a real
// Sentry call. Spreads the real module first so any other export server code
// starts using later (setUser, startSpan, etc.) still resolves to the real
// thing instead of `undefined` in every test file that transitively imports
// it. Tests that need to assert reportError's Sentry wiring (see
// tests/server/utils/errorReporting.test.ts) declare their own more specific
// vi.mock for this module, which takes precedence in that file.
vi.mock("@sentry/nuxt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/nuxt")>()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

Object.assign(globalThis, {
  computed,
  ref,
  reactive,
  watch,
  watchEffect,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
  onScopeDispose,
  nextTick,
  defineComponent,
  defineProps,
  defineEmits,
  withDefaults,
  useAttrs,
  useSlots,
  useId,
  useSyncSettings,
  useApiTokens,
  useHead: () => {},
});

// useTheme keeps a module-level `ref()` singleton, so it must be imported
// dynamically (after the Vue globals above are assigned) rather than via a
// static import, which vite hoists ahead of the Object.assign call.
const { useTheme } = await import("../app/composables/useTheme");
Object.assign(globalThis, { useTheme });
