<template>
  <LegalDocument eyebrow="legal" title="Privacy policy" :updated="UPDATED">
    <!--
      @todo DRAFT, not legal advice. Written from what the code does. The owner
      must review (contact address, jurisdiction, retention, processors) before
      relying on it.
    -->
    <p class="muted">
      This is a plain-language summary of what markpost collects and why. It is
      a draft pending owner review.
    </p>

    <h2 class="h2">What we store</h2>
    <ul class="col gap-2" style="padding-left: 20px">
      <li>
        Your account identifier from our sign-in provider, and the Stripe
        customer id if you subscribe.
      </li>
      <li>The sources, API tokens (stored hashed), and settings you create.</li>
      <li>
        Everything sent to your endpoints: webhook and email payloads are
        converted to Markdown records and kept until you delete them or your
        account.
      </li>
      <li>
        An activity log of events, automatically removed after
        {{ EVENT_RETENTION_DAYS }} days.
      </li>
    </ul>

    <h2 class="h2">Third parties</h2>
    <ul class="col gap-2" style="padding-left: 20px">
      <li>Clerk handles sign-in and holds your email and credentials.</li>
      <li>Stripe processes payments. We never see your card details.</li>
      <li>Neon hosts the database, and Netlify hosts the app.</li>
      <li>
        Sentry receives error reports and performance data, which may include
        session replays of the app.
      </li>
      <li>
        Google Analytics (GA4) measures site usage. It loads only if you accept
        analytics in the consent prompt.
      </li>
    </ul>

    <h2 class="h2">Analytics choice</h2>
    <p class="muted">
      Your choice is stored in this browser (local storage) and you can change
      it any time from the "cookie settings" link in the site footer. Declining
      never limits what you can do in markpost.
    </p>

    <h2 class="h2">Deleting your data</h2>
    <p class="muted">
      Deleting your account in settings cancels billing and removes your
      records, sources, tokens, and settings.
    </p>

    <h2 class="h2">Contact</h2>
    <p class="muted">
      Questions or requests: open an issue at
      <a href="https://github.com/neonpixels-studio/markpost">
        github.com/neonpixels-studio/markpost</a
      >.
    </p>
  </LegalDocument>
</template>

<script setup lang="ts">
import { EVENT_RETENTION_DAYS } from "#shared/utils/retention";

const UPDATED = "September 30, 2026";

useHead({ title: "Privacy policy" });
</script>
