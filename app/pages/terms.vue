<template>
  <LegalDocument eyebrow="legal" title="Terms of service" :updated="UPDATED">
    <!--
      @todo DRAFT, not legal advice. Written from what the code does. The owner
      must review (liability, governing law, refunds, acceptable use) before
      relying on it.
    -->
    <p class="muted">
      These are the basic terms for using markpost. They are a draft pending
      owner review.
    </p>

    <h2 class="h2">The service</h2>
    <p class="muted">
      markpost receives webhooks and email you point at it, converts them to
      Markdown, and makes them available for sync to your vault. It is provided
      as is, without warranties, and may change or be interrupted.
    </p>

    <h2 class="h2">Your account</h2>
    <p class="muted">
      You are responsible for your account, your API tokens, and the content
      sent to your endpoints. Keep secrets safe and rotate them if exposed.
    </p>

    <h2 class="h2">Acceptable use</h2>
    <p class="muted">
      Do not use markpost to send unlawful content, to abuse or overload the
      service, or to probe other users' data. We may throttle or suspend
      accounts that do.
    </p>

    <h2 class="h2">Billing</h2>
    <p class="muted">
      Paid plans are billed through Stripe and can be cancelled at any time; see
      <NuxtLink to="/pricing">pricing</NuxtLink> for plan limits. Your files
      stay yours when you cancel.
    </p>

    <h2 class="h2">Your data</h2>
    <p class="muted">
      You keep ownership of what you send us. How we handle it is described in
      the <NuxtLink to="/privacy">privacy policy</NuxtLink>.
    </p>

    <h2 class="h2">Liability</h2>
    <p class="muted">
      To the extent the law allows, markpost is not liable for lost data or
      indirect damages. Export your records if they matter to you.
    </p>
  </LegalDocument>
</template>

<script setup lang="ts">
const UPDATED = "September 30, 2026";

useHead({ title: "Terms of service" });
</script>
