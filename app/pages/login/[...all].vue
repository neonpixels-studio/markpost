<template>
  <div
    style="
      height: 100vh;
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: var(--bg);
    "
  >
    <!-- left: clerk form -->
    <div
      class="scroll"
      style="
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: 32px 40px;
      "
    >
      <NuxtLink to="/" style="align-self: flex-start">
        <AppLogo />
      </NuxtLink>
      <div style="flex: 1; display: grid; place-items: center">
        <div style="width: 100%; max-width: 380px">
          <AppEyebrow>welcome back</AppEyebrow>
          <h1 class="h1" style="margin-top: 14px; font-size: 34px">
            Sign in to markpost
          </h1>
          <p class="muted" style="margin-top: 8px; font-size: 14.5px">
            Pick up where your vault left off.
          </p>
          <div style="margin-top: 28px">
            <SignIn
              path="/login"
              :appearance="{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none border-0 p-0 bg-transparent',
                },
              }"
            />
          </div>
        </div>
      </div>
      <p class="mono faint" style="font-size: 11px; text-align: center">
        protected by clerk · SOC2 · 2FA ready
      </p>
    </div>

    <!-- right: decorative panel -->
    <div
      style="
        position: relative;
        border-left: 1px solid var(--line);
        background: var(--bg-2);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 48px 56px;
      "
    >
      <AppTopo :seed="9" />
      <div style="position: relative">
        <div class="term" style="max-width: 440px">
          <div class="term-bar">
            <span class="dots"><i /><i /><i /></span>
            <span class="t-title">markpost auth</span>
          </div>
          <div class="term-body">
            <div><span class="pr">$</span> markpost login</div>
            <div class="c-dim" style="margin-top: 6px">
              → opening browser to authenticate…
            </div>
            <div class="c-ok" style="margin-top: 6px">
              ✓ token saved to ~/.markpost/config
            </div>
            <div style="margin-top: 6px">
              <span class="pr">$</span> markpost sync
            </div>
            <div class="c-dim">→ 12 records synced to ~/vault</div>
          </div>
        </div>
        <blockquote style="margin-top: 32px; max-width: 420px">
          <p style="font-size: 18px; line-height: 1.5; letter-spacing: -0.01em">
            "It turned my chaotic inbox of clipped articles into a tidy folder
            of notes. I forget it's even running."
          </p>
          <footer class="mono faint" style="font-size: 12px; margin-top: 14px">
            — a very organized person, allegedly
          </footer>
        </blockquote>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: "Sign in" });
</script>
