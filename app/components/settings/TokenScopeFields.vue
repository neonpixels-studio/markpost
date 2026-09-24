<template>
  <div class="col gap-3">
    <label class="row gap-2" style="align-items: center">
      <input
        :checked="wantsScopes"
        type="checkbox"
        :disabled="disabled"
        :aria-describedby="wantsScopes ? scopesListId : hintId"
        @change="onWantsScopesChange"
      />
      <span style="font-size: 13px">Restrict to specific scopes</span>
    </label>
    <p
      v-if="!wantsScopes"
      :id="hintId"
      class="faint"
      style="font-size: 12px; margin: 0"
    >
      This token will have full access to every resource.
    </p>
    <div v-else :id="scopesListId" class="col gap-3">
      <div v-for="scope in SCOPES" :key="scope.name" class="col gap-1">
        <InputCheckbox
          :model-value="isScopeSelected(scope.name)"
          :label="scope.name"
          :disabled="disabled"
          @update:model-value="(checked) => onScopeToggle(scope.name, checked)"
        />
        <span class="faint" style="font-size: 11.5px; margin-left: 31px">
          {{ scope.description }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import InputCheckbox from "../InputCheckbox.vue";
import { SCOPES, type ScopeName } from "#shared/utils/scopes";

const props = withDefaults(
  defineProps<{
    wantsScopes?: boolean;
    scopes?: ScopeName[];
    disabled?: boolean;
  }>(),
  {
    wantsScopes: false,
    scopes: () => [],
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:wantsScopes": [value: boolean];
  "update:scopes": [value: ScopeName[]];
}>();

// Per-instance so two mints of this component on one page don't collide on a
// hardcoded DOM id and break aria-describedby's reference — same reasoning
// as TokenExpiryFields.vue's hintId.
const hintId = useId();
const scopesListId = useId();

function onWantsScopesChange(event: Event): void {
  emit("update:wantsScopes", (event.target as HTMLInputElement).checked);
}

function isScopeSelected(scopeName: ScopeName): boolean {
  return props.scopes.includes(scopeName);
}

function onScopeToggle(scopeName: ScopeName, checked: boolean): void {
  const nextScopes = checked
    ? [...props.scopes, scopeName]
    : props.scopes.filter((selected) => selected !== scopeName);

  emit("update:scopes", nextScopes);
}
</script>
