<template>
  <div
    class="scroll"
    style="height: 100vh; overflow-y: auto; background: var(--bg)"
  >
    <TheMarketingNav active="landing" />

    <!-- hero -->
    <AppReveal
      as="section"
      :style="{
        position: 'relative',
        padding: '76px 40px 64px',
        maxWidth: '1180px',
        margin: '0 auto',
      }"
    >
      <AppTopo :seed="4" />
      <div
        style="
          position: relative;
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 56px;
          align-items: center;
        "
      >
        <div>
          <AppEyebrow>self-hosted · markdown-native</AppEyebrow>
          <h1 class="display" style="margin-top: 22px">
            Every webhook<br />and email, as<br /><span class="outline"
              >Markdown.</span
            >
          </h1>
          <p class="lead" style="margin-top: 24px; max-width: 440px">
            markpost catches inbound webhooks and email, converts them to clean
            Markdown with frontmatter, and the CLI syncs them straight into your
            Obsidian vault — on your machine.
          </p>
          <div class="row wrap gap-3" style="margin-top: 30px">
            <AppBtn variant="accent" size="lg" icon-r="arrowR" href="/pricing">
              start free trial
            </AppBtn>
            <AppBtn size="lg" icon="book" href="/docs">read the docs</AppBtn>
          </div>
          <div
            class="row wrap mono gap-4"
            style="margin-top: 26px; font-size: 12px; color: var(--ink-3)"
          >
            <span class="row gap-2">
              <AppIcon
                name="check"
                :size="14"
                :style="{ color: 'var(--ok)' }"
              />no card to start
            </span>
            <span class="row gap-2">
              <AppIcon
                name="check"
                :size="14"
                :style="{ color: 'var(--ok)' }"
              />14-day Pro trial
            </span>
            <span class="row gap-2">
              <AppIcon
                name="check"
                :size="14"
                :style="{ color: 'var(--ok)' }"
              />your files, your disk
            </span>
          </div>
        </div>

        <!-- terminal -->
        <div class="term">
          <div class="term-bar">
            <span class="dots"><i /><i /><i /></span>
            <span class="t-title">~/vault — markpost</span>
          </div>
          <div class="term-body">
            <div>
              <span class="pr">$</span> markpost sync
              <span class="c-dim">--watch</span>
            </div>
            <div class="c-dim" style="margin-top: 6px">
              → connected to ingest.markpost.io
            </div>
            <div class="c-dim">→ watching for inbound records…</div>
            <div style="margin-top: 10px">
              <span class="c-acc">webhook</span> github:push
              <span class="c-dim">→</span>
              <span class="c-file">99-incoming/2026-06-14-deploy.md</span>
              <span class="c-ok">✓</span>
            </div>
            <div>
              <span class="c-acc">email</span>&nbsp;&nbsp; clip@markpost
              <span class="c-dim">→</span>
              <span class="c-file">99-incoming/swift-concurrency.md</span>
              <span class="c-ok">✓</span>
            </div>
            <div>
              <span class="c-acc">webhook</span> stripe:invoice
              <span class="c-dim">→</span>
              <span class="c-file">99-incoming/invoice-1042.md</span>
              <span class="c-ok">✓</span>
            </div>
            <div style="margin-top: 10px" class="c-dim">
              3 records written · 0 conflicts · idle
            </div>
            <div style="margin-top: 4px">
              <span class="pr">$</span>
              <span
                style="border-left: 7px solid var(--accent); margin-left: 2px"
                >&nbsp;</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- sources strip -->
      <div class="row wrap gap-6" style="margin-top: 48px; position: relative">
        <div class="row wrap gap-2">
          <span class="kicker" style="margin-right: 2px">two ways in</span>
          <AppChip accent>webhooks</AppChip>
          <AppChip accent>email-in</AppChip>
        </div>
        <span style="width: 1px; height: 22px; background: var(--line-2)" />
        <div class="row wrap gap-2">
          <span class="kicker" style="margin-right: 2px">presets</span>
          <AppChip v-for="preset in presets" :key="preset">{{
            preset
          }}</AppChip>
        </div>
      </div>
    </AppReveal>

    <div style="max-width: 1180px; margin: 0 auto; padding: 0 40px">
      <hr class="rule" />
    </div>

    <!-- how it works -->
    <AppReveal
      as="section"
      :style="{
        padding: '56px 40px 16px',
        maxWidth: '1180px',
        margin: '0 auto',
      }"
    >
      <div
        class="row between wrap"
        style="align-items: flex-end; margin-bottom: 36px"
      >
        <div>
          <AppEyebrow>how it works</AppEyebrow>
          <h2 class="h1" style="margin-top: 14px">
            Inbox to vault in three steps.
          </h2>
        </div>
        <span class="kicker">no servers to run</span>
      </div>
      <div
        style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px"
      >
        <div v-for="step in steps" :key="step.n" class="card card-pad">
          <div class="row between">
            <span
              :style="{
                width: '38px',
                height: '38px',
                borderRadius: '9px',
                border: '1px solid var(--line-2)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent)',
              }"
            >
              <AppIcon :name="step.ic" :size="19" />
            </span>
            <span class="mono" style="font-size: 13px; color: var(--ink-3)">{{
              step.n
            }}</span>
          </div>
          <h3 class="h3" style="margin-top: 18px">{{ step.t }}</h3>
          <p
            class="muted"
            style="margin-top: 8px; font-size: 14.5px; line-height: 1.55"
          >
            {{ step.d }}
          </p>
        </div>
      </div>
    </AppReveal>

    <!-- output preview -->
    <AppReveal
      as="section"
      :style="{
        padding: '44px 40px 64px',
        maxWidth: '1180px',
        margin: '0 auto',
      }"
    >
      <div
        class="panel"
        style="
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr 1.1fr;
        "
      >
        <div style="padding: 40px">
          <AppEyebrow>the output</AppEyebrow>
          <h2 class="h2" style="margin-top: 16px">
            Plain Markdown. Real frontmatter.
          </h2>
          <p
            class="muted"
            style="margin-top: 12px; font-size: 15px; line-height: 1.6"
          >
            No proprietary format, no lock-in. Every record is a portable
            <code
              class="mono"
              style="
                font-size: 13px;
                background: var(--bg-2);
                padding: 1px 5px;
                border-radius: 4px;
              "
              >.md</code
            >
            file your editor already understands — fully templated to match your
            vault's conventions.
          </p>
          <div class="chip-row" style="margin-top: 22px">
            <AppChip accent>YAML frontmatter</AppChip>
            <AppChip>custom filename</AppChip>
            <AppChip>tag mapping</AppChip>
            <AppChip>attachments</AppChip>
          </div>
        </div>
        <div
          class="code"
          style="
            border-radius: 0;
            border-top: 0;
            border-right: 0;
            border-bottom: 0;
          "
        >
          <div class="code-head">
            <span class="lang">2026-06-14-deploy.md</span>
            <span class="mono faint" style="font-size: 11px">markdown</span>
          </div>
          <div class="code-body" style="white-space: pre">
            --- <span class="k">title</span>: Production deploy succeeded
            <span class="k">source</span>: webhook/github
            <span class="k">created</span>:
            <span class="s">2026-06-14T09:41:02Z</span>
            <span class="k">tags</span>: [ci, deploy, incoming] ---

            <span class="c"># Production deploy succeeded</span>

            Commit <span class="s">a1f9c20</span> shipped to **prod** by @dan in
            47s. All checks green. > synced by markpost
          </div>
        </div>
      </div>
    </AppReveal>

    <!-- cta band -->
    <AppReveal
      as="section"
      :style="{ padding: '0 40px 72px', maxWidth: '1180px', margin: '0 auto' }"
    >
      <div
        class="card card-pad"
        style="
          position: relative;
          overflow: hidden;
          padding: 48px;
          text-align: center;
        "
      >
        <AppTopo :seed="11" />
        <div style="position: relative">
          <h2 class="h1">Stop copy-pasting into your vault.</h2>
          <p
            class="lead"
            style="margin-top: 12px; max-width: 460px; margin-inline: auto"
          >
            Wire up your first source in under five minutes.
          </p>
          <div
            class="row gap-3"
            style="justify-content: center; margin-top: 26px"
          >
            <AppBtn variant="accent" size="lg" icon-r="arrowR" href="/pricing">
              start free trial
            </AppBtn>
            <AppBtn size="lg" icon="terminal" href="/docs"
              >view CLI reference</AppBtn
            >
          </div>
        </div>
      </div>
    </AppReveal>

    <TheMarketingFooter />
  </div>
</template>

<script setup lang="ts">
useHead({ title: "Inbound webhooks & email, synced to your vault" });

const presets = ["stripe", "github", "zapier", "rss", "shortcuts"];

const steps = [
  {
    n: "01",
    ic: "zap",
    t: "Receive",
    d: "Point a webhook or forward an email to your unique markpost address. We capture the payload the instant it lands.",
  },
  {
    n: "02",
    ic: "fileText",
    t: "Convert",
    d: "HTML, JSON and rich email become clean Markdown with YAML frontmatter — titles, tags, source and timestamps included.",
  },
  {
    n: "03",
    ic: "refresh",
    t: "Sync",
    d: "The CLI writes files directly to your vault folder. Auto-delete clears the remote copy once it's safely on disk.",
  },
];
</script>
