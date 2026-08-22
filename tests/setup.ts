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
