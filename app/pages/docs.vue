<template>
  <div
    style="
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--bg);
    "
  >
    <!-- top nav -->
    <header
      class="row between"
      style="
        height: 56px;
        padding: 0 24px;
        border-bottom: 1px solid var(--line);
        flex: none;
        background: color-mix(in oklab, var(--bg) 86%, transparent);
        backdrop-filter: blur(8px);
      "
    >
      <div class="row gap-4">
        <NuxtLink to="/"><AppLogo :size="20" /></NuxtLink>
        <AppBadge tone="accent" style="font-size: 10px">docs</AppBadge>
      </div>
      <div class="row gap-3">
        <div class="input-wrap">
          <span class="lead-addon"><AppIcon name="search" :size="14" /></span>
          <input
            class="input has-lead"
            placeholder="search docs…"
            style="height: 34px; width: 200px; font-size: 13px"
          />
          <span class="addon"><AppKbd>/</AppKbd></span>
        </div>
        <a
          class="icon-btn"
          href="https://github.com"
          style="color: var(--ink-2)"
        >
          <AppIcon name="github" :size="18" />
        </a>
        <button
          class="icon-btn"
          style="color: var(--ink-2)"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="17" />
        </button>
        <AppBtn size="sm" variant="accent" href="/inbox">dashboard</AppBtn>
      </div>
    </header>

    <div
      style="
        display: grid;
        grid-template-columns: 248px 1fr 200px;
        flex: 1;
        min-height: 0;
      "
    >
      <!-- left sidebar -->
      <nav
        class="scroll"
        style="
          border-right: 1px solid var(--line);
          padding: 26px 18px;
          overflow-y: auto;
        "
      >
        <div
          v-for="group in DOC_NAV"
          :key="group.group"
          style="margin-bottom: 22px"
        >
          <span class="kicker" style="display: block; padding: 0 10px 8px">{{
            group.group
          }}</span>
          <div class="col gap-1">
            <button
              v-for="[id, label] in group.items"
              :key="id"
              :style="{
                textAlign: 'left',
                border: 0,
                cursor: 'pointer',
                background:
                  activePage === id ? 'var(--accent-tint)' : 'transparent',
                color: activePage === id ? 'var(--accent-700)' : 'var(--ink-2)',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '13.5px',
                fontWeight: activePage === id ? 600 : 400,
                fontFamily: activePage === id ? 'var(--mono)' : 'var(--sans)',
              }"
              @click="activePage = id"
            >
              {{ label }}
            </button>
          </div>
        </div>
      </nav>

      <!-- content -->
      <main class="scroll" style="overflow-y: auto; padding: 44px 56px 80px">
        <div style="max-width: 720px; margin: 0 auto">
          <span
            class="mono faint"
            style="
              font-size: 11px;
              letter-spacing: 0.1em;
              text-transform: uppercase;
            "
          >
            {{ activeGroup }}
          </span>
          <h1 class="h1" style="margin-top: 10px; font-size: 38px">
            {{ currentPage.title }}
          </h1>
          <p class="lead" style="margin-top: 12px">{{ currentPage.lead }}</p>
          <hr class="rule" style="margin-top: 26px" />

          <!-- dynamic content per page -->
          <component :is="currentPage.component" />

          <!-- prev / next -->
          <div class="row between" style="margin-top: 48px; gap: 14px">
            <DocNavButton
              dir="prev"
              :page="activePage"
              @navigate="activePage = $event"
            />
            <DocNavButton
              dir="next"
              :page="activePage"
              @navigate="activePage = $event"
            />
          </div>
        </div>
      </main>

      <!-- on this page -->
      <aside
        class="scroll"
        style="
          border-left: 1px solid var(--line);
          padding: 44px 20px;
          overflow-y: auto;
        "
      >
        <span class="kicker" style="display: block; margin-bottom: 12px"
          >on this page</span
        >
        <div class="col gap-2">
          <span
            v-for="(section, index) in currentPage.onpage"
            :key="section"
            class="mono"
            :style="{
              fontSize: '12px',
              color: index === 0 ? 'var(--accent-700)' : 'var(--ink-3)',
              paddingLeft: '10px',
              borderLeft: `2px solid ${index === 0 ? 'var(--accent)' : 'var(--line)'}`,
              cursor: 'pointer',
            }"
          >
            {{ section }}
          </span>
        </div>
        <div class="card" style="padding: 14px; margin-top: 28px">
          <span
            class="mono faint"
            style="
              font-size: 10.5px;
              letter-spacing: 0.1em;
              text-transform: uppercase;
            "
          >
            need a hand?
          </span>
          <p style="font-size: 13px; margin: 8px 0 12px; line-height: 1.5">
            Drop into the community or open an issue.
          </p>
          <AppBtn
            size="sm"
            :block="true"
            icon="github"
            href="https://github.com"
            >github</AppBtn
          >
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import DocNavButton from "~/components/DocNavButton.vue";
import QuickstartDoc from "~/components/docs/QuickstartDoc.vue";
import ConceptsDoc from "~/components/docs/ConceptsDoc.vue";
import AuthDoc from "~/components/docs/AuthDoc.vue";
import WebhooksDoc from "~/components/docs/WebhooksDoc.vue";
import EmailDoc from "~/components/docs/EmailDoc.vue";
import RecordsDoc from "~/components/docs/RecordsDoc.vue";
import CliDoc from "~/components/docs/CliDoc.vue";
import MarkdownDoc from "~/components/docs/MarkdownDoc.vue";

useHead({ title: "Documentation" });

const { isDark, initTheme, toggleTheme } = useTheme();
onMounted(initTheme);

const DOC_NAV = [
  {
    group: "Introduction",
    items: [
      ["quickstart", "Quickstart"],
      ["concepts", "Core concepts"],
    ],
  },
  {
    group: "API Reference",
    items: [
      ["auth", "Authentication"],
      ["webhooks", "Ingest a webhook"],
      ["email", "Email-in"],
      ["records", "List records"],
    ],
  },
  {
    group: "CLI",
    items: [
      ["cli", "Command reference"],
      ["markdown", "Markdown & frontmatter"],
    ],
  },
] as const;

type PageId =
  | "quickstart"
  | "concepts"
  | "auth"
  | "webhooks"
  | "email"
  | "records"
  | "cli"
  | "markdown";

const activePage = ref<PageId>("quickstart");

const DOC_PAGES: Record<
  PageId,
  {
    title: string;
    lead: string;
    onpage: string[];
    component: ReturnType<typeof defineComponent>;
  }
> = {
  quickstart: {
    title: "Quickstart",
    lead: "Go from zero to your first synced Markdown file in about five minutes.",
    onpage: ["Install the CLI", "Authenticate", "Point a source", "Sync"],
    component: QuickstartDoc,
  },
  concepts: {
    title: "Core concepts",
    lead: "The handful of nouns that make up markpost.",
    onpage: ["Records", "Sources", "Sync"],
    component: ConceptsDoc,
  },
  auth: {
    title: "Authentication",
    lead: "All API requests authenticate with a bearer token.",
    onpage: ["Tokens", "Making a request", "Errors"],
    component: AuthDoc,
  },
  webhooks: {
    title: "Ingest a webhook",
    lead: "POST any JSON and markpost turns it into a record.",
    onpage: ["Endpoint", "Request", "Response", "Mapping"],
    component: WebhooksDoc,
  },
  email: {
    title: "Email-in",
    lead: "Forward or send mail to capture it as Markdown.",
    onpage: ["Your address", "What's stripped"],
    component: EmailDoc,
  },
  records: {
    title: "List records",
    lead: "Read pending and synced records over the API.",
    onpage: ["Endpoint", "Response"],
    component: RecordsDoc,
  },
  cli: {
    title: "Command reference",
    lead: "Everything the markpost binary can do.",
    onpage: ["Commands", "Flags"],
    component: CliDoc,
  },
  markdown: {
    title: "Markdown & frontmatter",
    lead: "How records become files in your vault.",
    onpage: ["Frontmatter", "Filenames", "Templates"],
    component: MarkdownDoc,
  },
};

const currentPage = computed(() => DOC_PAGES[activePage.value]);

const activeGroup = computed(() => {
  const found = DOC_NAV.find((group) =>
    group.items.some(([id]) => id === activePage.value),
  );
  return found?.group ?? "";
});
</script>
