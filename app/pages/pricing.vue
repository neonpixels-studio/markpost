<template>
  <div
    class="scroll"
    style="height: 100vh; overflow-y: auto; background: var(--bg)"
  >
    <TheMarketingNav active="pricing" />

    <AppReveal
      as="section"
      :style="{
        position: 'relative',
        padding: '64px 40px 28px',
        maxWidth: '1100px',
        margin: '0 auto',
        textAlign: 'center',
      }"
    >
      <AppTopo :seed="7" />
      <div style="position: relative">
        <AppEyebrow>pricing</AppEyebrow>
        <h1
          class="h1"
          style="margin-top: 16px; font-size: clamp(32px, 4vw, 46px)"
        >
          Simple, file-sized pricing.
        </h1>
        <p
          class="lead"
          style="margin-top: 14px; max-width: 460px; margin-inline: auto"
        >
          Start free forever. Upgrade when you outgrow it — cancel any time,
          keep every file.
        </p>
        <div
          class="row"
          style="justify-content: center; margin-top: 26px; gap: 12px"
        >
          <InputSegmented
            v-model="cycle"
            :options="[
              { value: 'monthly', label: 'monthly' },
              { value: 'yearly', label: 'yearly' },
            ]"
          />
          <AppBadge
            tone="accent"
            :style="{
              alignSelf: 'center',
              opacity: cycle === 'yearly' ? 1 : 0,
              transition: 'opacity .2s',
            }"
          >
            save 20%
          </AppBadge>
        </div>
      </div>
    </AppReveal>

    <section style="padding: 16px 40px 24px; max-width: 920px; margin: 0 auto">
      <div
        style="
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          align-items: stretch;
        "
      >
        <!-- Hobby -->
        <AppReveal
          class="card"
          :style="{ padding: '32px', display: 'flex', flexDirection: 'column' }"
        >
          <div class="row between">
            <div>
              <AppEyebrow>free</AppEyebrow>
              <h3 class="h2" style="margin-top: 12px">Hobby</h3>
            </div>
          </div>
          <div
            class="row"
            style="align-items: baseline; gap: 4px; margin-top: 18px"
          >
            <span
              style="font-size: 44px; font-weight: 600; letter-spacing: -0.03em"
              >$0</span
            >
            <span class="mono faint" style="font-size: 13px">/forever</span>
          </div>
          <p class="muted" style="margin-top: 8px; font-size: 14px">
            For a single vault and the occasional sync.
          </p>
          <AppBtn
            :block="true"
            size="lg"
            href="/login"
            style="margin-top: 22px"
          >
            get started
          </AppBtn>
          <ul
            style="
              list-style: none;
              padding: 0;
              margin: 26px 0 0;
              display: grid;
              gap: 12px;
            "
          >
            <li
              v-for="feature in hobbyFeatures"
              :key="feature"
              class="row gap-3"
              style="font-size: 14.5px"
            >
              <AppIcon
                name="check"
                :size="16"
                :style="{
                  color: 'var(--accent)',
                  flex: 'none',
                  marginTop: '2px',
                }"
              />
              <span>{{ feature }}</span>
            </li>
          </ul>
        </AppReveal>

        <!-- Pro -->
        <AppReveal
          :delay="110"
          class="card"
          :style="{
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--line))',
            boxShadow: 'var(--sh-2)',
          }"
        >
          <AppBadge
            tone="accent"
            style="position: absolute; top: 20px; right: 20px"
          >
            most popular
          </AppBadge>
          <AppEyebrow>pro</AppEyebrow>
          <h3 class="h2" style="margin-top: 12px">Pro</h3>
          <div
            class="row"
            style="align-items: baseline; gap: 4px; margin-top: 18px"
          >
            <span
              style="font-size: 44px; font-weight: 600; letter-spacing: -0.03em"
            >
              ${{ proPricing.price }}
            </span>
            <span class="mono faint" style="font-size: 13px">{{
              proPricing.per
            }}</span>
            <AppBadge v-if="proPricing.save" tone="ok" style="margin-left: 8px">
              {{ proPricing.save }}
            </AppBadge>
          </div>
          <p class="muted mono" style="margin-top: 8px; font-size: 12.5px">
            {{ proPricing.sub }}
          </p>
          <AppBtn
            :block="true"
            size="lg"
            variant="accent"
            icon-r="arrowR"
            href="/login"
            style="margin-top: 22px"
          >
            start 14-day trial
          </AppBtn>
          <ul
            style="
              list-style: none;
              padding: 0;
              margin: 26px 0 0;
              display: grid;
              gap: 12px;
            "
          >
            <li
              class="mono"
              style="
                font-size: 11px;
                letter-spacing: 0.1em;
                text-transform: uppercase;
                color: var(--ink-3);
              "
            >
              Everything in Hobby, plus
            </li>
            <li
              v-for="feature in proFeatures"
              :key="feature"
              class="row gap-3"
              style="font-size: 14.5px"
            >
              <AppIcon
                name="check"
                :size="16"
                :style="{
                  color: 'var(--accent)',
                  flex: 'none',
                  marginTop: '2px',
                }"
              />
              <span>{{ feature }}</span>
            </li>
          </ul>
        </AppReveal>
      </div>
      <p
        class="mono faint"
        style="font-size: 12px; text-align: center; margin-top: 22px"
      >
        self-hosting? markpost is source-available —
        <NuxtLink
          to="/docs"
          style="
            color: var(--accent-700);
            text-decoration: underline;
            font-size: 12px;
            font-family: var(--mono);
          "
        >
          run it yourself →
        </NuxtLink>
      </p>
    </section>

    <!-- comparison table -->
    <AppReveal
      as="section"
      :style="{ padding: '28px 40px 8px', maxWidth: '860px', margin: '0 auto' }"
    >
      <div
        class="row between wrap"
        style="align-items: flex-end; margin-bottom: 18px"
      >
        <div>
          <AppEyebrow>compare</AppEyebrow>
          <h2 class="h2" style="margin-top: 12px">
            Every detail, side by side.
          </h2>
        </div>
        <span class="kicker">billed {{ cycle }}</span>
      </div>
      <div class="card" style="overflow: hidden">
        <div
          class="row"
          style="
            padding: 14px 22px;
            border-bottom: 1px solid var(--line);
            background: var(--bg-2);
          "
        >
          <span class="kicker grow">feature</span>
          <span style="width: 120px; text-align: center" class="mono faint"
            >Hobby · $0</span
          >
          <span
            style="
              width: 140px;
              text-align: center;
              display: flex;
              justify-content: center;
            "
          >
            <AppBadge tone="accent"
              >Pro · ${{ proPricing.price }}{{ proPricing.per }}</AppBadge
            >
          </span>
        </div>
        <div class="divide-y">
          <div
            v-for="([feat, hobbyVal, proVal], index) in comparisonRows"
            :key="index"
            class="row"
            style="
              padding: 13px 22px;
              align-items: center;
              transition: background 0.1s;
            "
            @mouseenter="
              ($event.currentTarget as HTMLElement).style.background =
                'var(--bg-2)'
            "
            @mouseleave="
              ($event.currentTarget as HTMLElement).style.background =
                'transparent'
            "
          >
            <span class="grow" style="font-size: 14px">{{ feat }}</span>
            <span style="width: 120px; text-align: center" class="mono">
              <AppIcon
                v-if="hobbyVal === '✓'"
                name="check"
                :size="16"
                :style="{ color: 'var(--ink-2)' }"
              />
              <span v-else-if="hobbyVal === '—'" class="faint">—</span>
              <span v-else class="muted" style="font-size: 13px">{{
                hobbyVal
              }}</span>
            </span>
            <span style="width: 140px; text-align: center" class="mono">
              <AppIcon
                v-if="proVal === '✓'"
                name="check"
                :size="16"
                :style="{ color: 'var(--accent)' }"
              />
              <span
                v-else
                style="
                  font-size: 13px;
                  color: var(--accent-700);
                  font-weight: 500;
                "
                >{{ proVal }}</span
              >
            </span>
          </div>
        </div>
      </div>
      <div
        class="row gap-3"
        style="justify-content: flex-end; margin-top: 18px"
      >
        <AppBtn href="/login">get started free</AppBtn>
        <AppBtn variant="accent" icon-r="arrowR" href="/login"
          >start Pro trial</AppBtn
        >
      </div>
    </AppReveal>

    <!-- faq -->
    <AppReveal
      as="section"
      :style="{
        padding: '40px 40px 72px',
        maxWidth: '760px',
        margin: '0 auto',
      }"
    >
      <hr class="rule" />
      <h2 class="h2" style="margin-top: 28px">Questions</h2>
      <div class="divide-y" style="margin-top: 16px">
        <div v-for="faq in faqs" :key="faq.q" style="padding: 16px 0">
          <button
            class="row between"
            style="
              width: 100%;
              background: none;
              border: 0;
              cursor: pointer;
              text-align: left;
              padding: 0;
            "
            @click="faq.open = !faq.open"
          >
            <span style="font-size: 16px; font-weight: 500">{{ faq.q }}</span>
            <AppIcon
              name="chevD"
              :size="18"
              :style="{
                color: 'var(--ink-3)',
                transform: faq.open ? 'rotate(180deg)' : 'none',
                transition: 'transform .2s',
              }"
            />
          </button>
          <p
            v-if="faq.open"
            class="muted"
            style="
              margin-top: 10px;
              font-size: 14.5px;
              line-height: 1.6;
              max-width: 600px;
            "
          >
            {{ faq.a }}
          </p>
        </div>
      </div>
    </AppReveal>

    <TheMarketingFooter />
  </div>
</template>

<script setup lang="ts">
useHead({ title: "Pricing" });

const cycle = ref<"monthly" | "yearly">("yearly");

const proPricing = computed(() => {
  if (cycle.value === "yearly") {
    return {
      price: "8",
      per: "/mo",
      sub: "$80 billed yearly",
      save: "2 months free",
    };
  }
  return { price: "10", per: "/mo", sub: "billed monthly", save: null };
});

const hobbyFeatures = [
  "1 connected source",
  "100 records / month",
  "Manual markpost sync",
  "7-day record retention",
  "Community support",
];

const proFeatures = [
  "Unlimited sources",
  "Unlimited records",
  "Auto-sync & --watch mode",
  "Auto-delete after sync",
  "Unlimited retention",
  "Custom filename templates",
  "Priority support",
];

const comparisonRows = [
  ["Connected sources", "1", "Unlimited"],
  ["Records / month", "100", "Unlimited"],
  ["Inbound webhook endpoint", "✓", "✓"],
  ["Email-in address", "✓", "✓"],
  ["Provider presets — Stripe, GitHub, Zapier", "1", "Unlimited"],
  ["Auto-sync (--watch mode)", "—", "✓"],
  ["Auto-delete after sync", "—", "✓"],
  ["Custom filename templates", "—", "✓"],
  ["YAML frontmatter", "✓", "✓"],
  ["Record retention", "7 days", "Unlimited"],
  ["Support", "Community", "Priority"],
] as [string, string, string][];

const faqs = reactive([
  {
    q: "What counts as a record?",
    a: "Any single inbound item — one webhook payload or one email becomes one Markdown file.",
    open: false,
  },
  {
    q: "Where do my files live?",
    a: "On your machine, in whatever folder you point the CLI at. markpost never holds your files hostage.",
    open: false,
  },
  {
    q: "What happens after the trial?",
    a: "You drop to the free Hobby plan automatically. Nothing is deleted, sources just pause past the limit.",
    open: false,
  },
  {
    q: "Can I self-host?",
    a: "Yes. markpost is source-available — bring your own Postgres and run the ingest server anywhere.",
    open: false,
  },
]);
</script>
