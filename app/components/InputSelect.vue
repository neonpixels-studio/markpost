<template>
  <AppField
    :num="num"
    :label="label"
    :req="req"
    :opt="opt"
    :msg="msg"
    :state="state"
  >
    <select
      class="select"
      :value="modelValue"
      :disabled="disabled"
      @change="
        emit('update:modelValue', ($event.target as HTMLSelectElement).value)
      "
    >
      <option
        v-for="option in normalizedOptions"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>
  </AppField>
</template>

<script setup lang="ts">
import {
  normalizeSelectOptions,
  type SelectOption,
} from "../utils/selectOptions";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: readonly SelectOption[];
    label?: string;
    num?: string;
    state?: "" | "err" | "ok";
    msg?: string;
    req?: boolean;
    opt?: boolean;
    disabled?: boolean;
  }>(),
  {
    state: "",
    req: false,
    opt: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const normalizedOptions = computed(() => normalizeSelectOptions(props.options));
</script>
