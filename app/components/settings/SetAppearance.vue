<template>
  <div>
    <SetHead
      eyebrow="appearance"
      title="Appearance"
      desc="Personalize markpost. Your theme and accent colour are saved to your account and follow you everywhere."
    />

    <div class="card card-pad">
      <span class="field-label" style="margin-bottom: 12px">
        <span class="num">01</span> Theme
      </span>
      <div class="row wrap gap-3">
        <button
          v-for="themeOption in THEME_OPTIONS"
          :key="themeOption.id"
          class="col"
          :style="{
            flex: 1,
            minWidth: '150px',
            cursor: 'pointer',
            border: '1px solid',
            borderColor:
              currentTheme === themeOption.id
                ? 'var(--accent)'
                : 'var(--line-2)',
            borderRadius: '10px',
            padding: '14px',
            background:
              currentTheme === themeOption.id
                ? 'var(--accent-tint)'
                : 'var(--surface-2)',
            gap: '10px',
            alignItems: 'stretch',
            boxShadow:
              currentTheme === themeOption.id
                ? '0 0 0 3px var(--accent-tint)'
                : 'none',
          }"
          @click="onThemeSelect(themeOption.id)"
        >
          <div
            :style="{
              height: '56px',
              borderRadius: '7px',
              border: '1px solid var(--line)',
              overflow: 'hidden',
              background: themeOption.id === 'dark' ? '#1a1916' : '#f4f3ef',
              display: 'flex',
            }"
          >
            <div
              :style="{
                width: '34%',
                borderRight:
                  '1px solid ' +
                  (themeOption.id === 'dark' ? '#2a2823' : '#e5e2da'),
                padding: '6px',
              }"
            >
              <div
                style="
                  height: 5px;
                  border-radius: 2px;
                  background: var(--accent);
                  width: 70%;
                "
              />
              <div
                :style="{
                  height: '4px',
                  borderRadius: '2px',
                  background: themeOption.id === 'dark' ? '#3a3730' : '#d6d2c8',
                  width: '90%',
                  marginTop: '5px',
                }"
              />
            </div>
            <div style="flex: 1; padding: 6px">
              <div
                :style="{
                  height: '4px',
                  borderRadius: '2px',
                  background: themeOption.id === 'dark' ? '#3a3730' : '#d6d2c8',
                  width: '80%',
                }"
              />
              <div
                :style="{
                  height: '4px',
                  borderRadius: '2px',
                  background: themeOption.id === 'dark' ? '#3a3730' : '#d6d2c8',
                  width: '55%',
                  marginTop: '5px',
                }"
              />
            </div>
          </div>
          <span
            class="row mono gap-2"
            :style="{
              fontSize: '12.5px',
              color:
                currentTheme === themeOption.id
                  ? 'var(--accent-700)'
                  : 'var(--ink-2)',
              fontWeight: currentTheme === themeOption.id ? 600 : 500,
            }"
          >
            <AppIcon :name="themeOption.ic" :size="15" />
            {{ themeOption.label }}
            <AppIcon
              v-if="currentTheme === themeOption.id"
              name="check"
              :size="14"
              style="margin-left: auto"
            />
          </span>
        </button>
      </div>

      <hr class="hairline" style="margin: 24px 0" />

      <span class="field-label" style="margin-bottom: 4px">
        <span class="num">02</span> Accent colour
      </span>
      <p class="muted" style="font-size: 13px; margin-bottom: 16px">
        Tints buttons, links, focus rings and highlights across the app.
      </p>
      <div
        style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px"
      >
        <button
          v-for="accentOption in ACCENT_OPTIONS"
          :key="accentOption.id"
          class="col"
          :style="{
            alignItems: 'center',
            gap: '7px',
            background: 'none',
            border: 0,
            cursor: 'pointer',
          }"
          :title="accentOption.name"
          @click="onAccentSelect(accentOption.hex)"
        >
          <span
            :style="{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: accentOption.hex,
              display: 'grid',
              placeItems: 'center',
              boxShadow:
                currentAccent === accentOption.hex
                  ? `0 0 0 2px var(--surface), 0 0 0 4px ${accentOption.hex}`
                  : 'none',
              transition: 'all .12s',
            }"
          >
            <AppIcon
              v-if="currentAccent === accentOption.hex"
              name="check"
              :size="18"
              :style="{ color: '#fff' }"
            />
          </span>
          <span
            class="mono"
            :style="{
              fontSize: '10px',
              color:
                currentAccent === accentOption.hex
                  ? 'var(--ink)'
                  : 'var(--ink-3)',
              letterSpacing: '.02em',
            }"
          >
            {{ accentOption.name }}
          </span>
        </button>
      </div>

      <hr class="hairline" style="margin: 24px 0" />

      <span class="field-label" style="margin-bottom: 12px">Preview</span>
      <div class="panel" style="padding: 18px">
        <div class="row between wrap gap-3">
          <div class="row wrap gap-2">
            <AppBtn variant="accent" size="sm" icon-r="arrowR">primary</AppBtn>
            <AppBtn size="sm">secondary</AppBtn>
            <AppBadge tone="accent" dot>accent badge</AppBadge>
          </div>
          <span class="mono" style="font-size: 12px; color: var(--accent-700)"
            >a tinted link →</span
          >
        </div>
        <div class="row gap-3" style="margin-top: 14px">
          <div class="grow">
            <AppField state="ok" msg="focus ring uses your accent">
              <input class="input" value="markpost" />
            </AppField>
          </div>
        </div>
      </div>

      <p
        v-if="loadError"
        class="muted"
        style="margin-top: 16px; font-size: 13px; color: var(--err, #e11d48)"
      >
        {{ loadError }}
      </p>
      <p
        v-if="saveError"
        class="muted"
        style="margin-top: 16px; font-size: 13px; color: var(--err, #e11d48)"
      >
        {{ saveError }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import SetHead from "./SetHead.vue";
import { HEX_COLOR_PATTERN } from "#shared/utils/accentColor";

const ACCENT_OPTIONS = [
  { id: "violet", name: "violet", hex: "#a855f7" },
  { id: "indigo", name: "indigo", hex: "#6366f1" },
  { id: "blue", name: "blue", hex: "#2f6fed" },
  { id: "emerald", name: "emerald", hex: "#0e9f6e" },
  { id: "amber", name: "amber", hex: "#d98613" },
  { id: "orange", name: "orange", hex: "#ea580c" },
  { id: "rose", name: "rose", hex: "#e11d6b" },
  { id: "ink", name: "graphite", hex: "#3f3d39" },
];

const VALID_THEMES = ["light", "dark", "system"] as const;

const THEME_OPTIONS = [
  { id: "light", ic: "sun", label: "Light" },
  { id: "dark", ic: "moon", label: "Dark" },
  { id: "system", ic: "sliders", label: "System" },
];

const {
  isDark,
  setTheme,
  persistAccentLocally,
  persistThemeChoiceLocally,
  getStoredThemeChoice,
  getStoredAccent,
} = useTheme();
const {
  accentColor: accountAccent,
  theme: accountTheme,
  fetchSettings,
  updateAppearance,
} = useSettings();

const currentTheme = ref("light");
const currentAccent = ref("#a855f7");
const saveError = ref<string | null>(null);
const loadError = ref<string | null>(null);
// Per-dimension guards: prevent the server response from clobbering a selection
// the user made while the initial GET was in flight.
const userChoseTheme = ref(false);
const userChoseAccent = ref(false);

function isValidTheme(value: string): value is (typeof VALID_THEMES)[number] {
  return (VALID_THEMES as readonly string[]).includes(value);
}

function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function resolveThemeFromAccount(accountThemeValue: string): void {
  if (!isValidTheme(accountThemeValue)) {
    return;
  }
  currentTheme.value = accountThemeValue;
  persistThemeChoiceLocally(accountThemeValue);
  applyThemeLocally(accountThemeValue);
}

function resolveAccentFromAccount(hex: string): void {
  if (!isValidHexColor(hex)) {
    return;
  }
  currentAccent.value = hex;
  persistAccentLocally(hex);
}

function applyThemeLocally(themeId: string): void {
  if (themeId === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    setTheme(prefersDark ? "dark" : "light");
    return;
  }
  setTheme(themeId as "dark" | "light");
}

function resolveInitialTheme(): void {
  const storedThemeChoice = getStoredThemeChoice();
  if (storedThemeChoice) {
    currentTheme.value = storedThemeChoice;
    return;
  }
  currentTheme.value = isDark.value ? "dark" : "light";
}

function resolveInitialAccent(): void {
  const storedAccent = getStoredAccent();
  if (storedAccent) {
    currentAccent.value = storedAccent;
  }
}

onMounted(async () => {
  resolveInitialTheme();
  resolveInitialAccent();

  try {
    await fetchSettings();
  } catch {
    loadError.value =
      "Couldn't load your account settings. Showing local values.";
    return;
  }

  if (!userChoseTheme.value && accountTheme.value) {
    resolveThemeFromAccount(accountTheme.value);
  }

  if (!userChoseAccent.value && accountAccent.value) {
    resolveAccentFromAccount(accountAccent.value);
  }
});

async function onThemeSelect(themeId: string): Promise<void> {
  saveError.value = null;
  userChoseTheme.value = true;
  currentTheme.value = themeId;
  persistThemeChoiceLocally(themeId);
  applyThemeLocally(themeId);
  try {
    await updateAppearance({ theme: themeId });
  } catch {
    saveError.value = "Couldn't save theme to your account. Try again.";
  }
}

async function onAccentSelect(hex: string): Promise<void> {
  saveError.value = null;
  userChoseAccent.value = true;
  currentAccent.value = hex;
  persistAccentLocally(hex);
  try {
    await updateAppearance({ accentColor: hex });
  } catch {
    saveError.value = "Couldn't save accent colour to your account. Try again.";
  }
}
</script>
