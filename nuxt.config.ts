import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  future: { compatibilityVersion: 4 },
  modules: ["@clerk/nuxt", "@sentry/nuxt/module", "@pinia/nuxt"],
  sourcemap: { client: "hidden" },
  sentry: {
    sourceMapsUploadOptions: {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
  },
  clerk: {
    skipServerMiddleware: true,
  },
  runtimeConfig: {
    databaseUrl: process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || "",
    // Read process.env INLINE so the value bakes into the server bundle at build
    // time. The Netlify preset does not re-inject NUXT_* at function runtime, so a
    // bare "" default would resolve to empty in the deployed function.
    disableSignups: process.env.NUXT_DISABLE_SIGNUPS || "",
    public: {
      sentryDsn: "",
      gaId: "",
    },
  },
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
  nitro: {
    preset: "netlify",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
