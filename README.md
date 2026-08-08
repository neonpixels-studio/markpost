# Markpost

A content aggregation service for syncing and storing records from across the internet.

## Requirements

- Node.js >= 24 (see [.nvmrc](.nvmrc))
- npm

## Setup

Install dependencies:

```bash
npm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

See `.env.example` for descriptions of each variable and where to obtain them.

## Database

The app uses [Drizzle ORM](https://orm.drizzle.team) with a [Neon](https://neon.tech) serverless Postgres database.

Push the schema to Neon (useful for initial setup):

```bash
npm run db:push
```

Generate a migration from schema changes:

```bash
npm run db:generate
```

Apply pending migrations:

```bash
npm run db:migrate
```

Open Drizzle Studio (visual database browser):

```bash
npm run db:studio
```

| Table           | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `records`       | Content records with uuid, title, content, and created_at           |
| `subscriptions` | One row per user tracking plan, status, trial dates, and Stripe IDs |

## Sources and webhook signature verification

A source is a unique ingest endpoint (`/api/hooks/:slug`) that turns an incoming webhook into a record. The Add Source modal offers presets (Stripe, GitHub, Zapier, Apple Shortcuts) that are a plain webhook source with a `provider` set, which enables signature verification on every delivery — see `server/utils/signatureVerifier.ts`.

| Provider        | Verification                                              | Secret                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe          | HMAC-SHA256 over the `Stripe-Signature` header            | User-supplied at creation — Stripe issues the signing secret when the user creates their own webhook endpoint, so the Add Source modal asks them to paste it in before the source can be created. Stored as-is (HMAC needs the raw value). Unrelated to the app's own billing webhook, which verifies against the separate `STRIPE_WEBHOOK_SECRET` env var (see "Billing and subscriptions" below). |
| GitHub          | HMAC-SHA256 over the `X-Hub-Signature-256` header         | Generated per source at creation time; paste it into the GitHub repo's Settings → Webhooks → Secret field. Stored as-is (HMAC needs the raw value).                                                                                                                                                                                                                                                 |
| Zapier          | Shared secret compared via the `X-Markpost-Secret` header | Generated per source at creation time; add it as a custom header on the Zapier webhook action. Only a SHA-256 hash is stored, since equality comparison never needs the plaintext back.                                                                                                                                                                                                             |
| Apple Shortcuts | Shared secret compared via the `X-Markpost-Secret` header | Generated per source at creation time; add it as a custom header in the "Get Contents of URL" action. Only a SHA-256 hash is stored, for the same reason as Zapier.                                                                                                                                                                                                                                 |

A generated secret (GitHub/Zapier/Shortcuts) is revealed exactly once, in the response to the request that created the source (the Add Source modal shows a one-time "copy this now" step) — the API never returns it again on subsequent `GET`/`PATCH` calls, and the reactive source list in the app never holds onto it either. A user-supplied secret (Stripe) is never shown back, since the user already has it.

Sources created before this verification model existed (`provider` left `null`) keep working unauthenticated rather than being retroactively broken — enabling verification is opt-in for new sources, not a forced migration for old ones.

**Payload size cap.** Ingest rejects any delivery whose body exceeds `MAX_WEBHOOK_BODY_BYTES` (1 MiB) with a `413`, checked by `Content-Length` before buffering and again on the decoded body about to be stored (see `server/utils/webhookBodyLimit.ts`). The rate limit caps request count, not size, so this is what stops a single oversized body from bloating storage and memory on an endpoint that only needs a slug to reach.

**Rotating a secret.** `POST /api/sources/:uuid/rotate-secret` rotates a leaked or lost secret in place — the `endpointSlug` is preserved, so the provider's existing webhook URL keeps working and only the secret has to be re-pasted. It never changes the source's `provider`; `PATCH /api/sources/:uuid` still deliberately ignores `provider`/`providerSecret` (that endpoint is for `routeFolder`/`fieldMapping` only). Behaviour mirrors source creation per provider:

- **GitHub** — generates a new HMAC secret and reveals the plaintext exactly once in the response (paste it into the GitHub webhook's Secret field). Sending a `providerSecret` is rejected — the value is server-generated.
- **Zapier / Apple Shortcuts** — generates a new shared secret, stores only its SHA-256 hash, and reveals the plaintext exactly once (update the custom header on that provider). Sending a `providerSecret` is rejected.
- **Stripe** — the caller supplies the new signing secret in `data.attributes.providerSecret` (Stripe issues it when the endpoint is rotated on Stripe's side). It is stored as-is and never echoed back, since the caller already has it.

A source with no `provider` set has no rotatable secret, so the endpoint returns `422`. As with creation, a generated secret is revealed only in the rotate response itself — never again on `GET`/`PATCH`.

Rotation takes effect immediately and there is no overlap window: the old secret stops verifying the moment the rotation commits, so any delivery that arrives before you paste the new secret into the provider fails signature verification (GitHub does not retry those). Paste the revealed secret into the provider right away. A dual-secret grace window that keeps the previous secret valid for a few minutes is a reasonable follow-up if this gap becomes a problem. The write uses optimistic concurrency (gated on the secret it just read), so two racing rotations can't both "win" — the loser gets a `409` and should retry rather than pasting a secret that was never stored.

RSS/Atom is listed as a preset but marked unavailable in the UI: there is no polling infrastructure (scheduler, dedup, fetch cadence) to back it yet.

## Billing and subscriptions

Billing is handled via [Stripe](https://stripe.com). The integration consists of three API routes under `/api/billing/`:

| Route                   | Method | Auth                    | Description                                                                                                                                                                                                                                           |
| ----------------------- | ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/billing/checkout` | POST   | Clerk / API token       | Creates a Stripe Checkout session for upgrading to Pro. Returns `{ data: { url } }` — redirect the user to this URL.                                                                                                                                  |
| `/api/billing/portal`   | POST   | Clerk / API token       | Creates a Stripe Customer Portal session for managing an existing subscription. Returns `{ data: { url } }`. Requires the user to have an existing Stripe customer ID (i.e. they have completed at least one Checkout session).                       |
| `/api/billing/webhook`  | POST   | None (Stripe signature) | Receives Stripe lifecycle events (`customer.subscription.created/updated/deleted`, `checkout.session.completed`) and updates the local `subscriptions` table. The Stripe-Signature header is verified on every request using `STRIPE_WEBHOOK_SECRET`. |
| `/api/billing/usage`    | GET    | Clerk / API token       | Returns the number of records created this month (the same metric the Hobby monthly cap enforces) and the number of connected sources.                                                                                                                |

### Required environment variables

| Variable                     | Description                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`          | Stripe secret key (from [Dashboard → API Keys](https://dashboard.stripe.com/apikeys)). Server-only.                           |
| `STRIPE_WEBHOOK_SECRET`      | Webhook signing secret (from [Dashboard → Webhooks → your endpoint → Signing secret](https://dashboard.stripe.com/webhooks)). |
| `STRIPE_PRO_PRICE_ID`        | Stripe price ID for the monthly Pro plan.                                                                                     |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Stripe price ID for the annual Pro plan (optional; falls back to monthly).                                                    |

### Setting up the Stripe webhook

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks) and add an endpoint pointing to `https://your-domain.com/api/billing/webhook`.
2. Subscribe to: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`.
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

For local development, use the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe listen --forward-to http://localhost:3000/api/billing/webhook
```

## Authentication

Authentication is handled by [Clerk](https://clerk.com) via the `@clerk/nuxt` module. Server middleware at `server/middleware/auth.ts` verifies the session on every request and makes the user available at `event.context.userId` in API route handlers.

## Development

Start the dev server at `http://localhost:3000`:

```bash
npm run dev
```

## Testing

Run unit tests in watch mode:

```bash
npm test
```

Run once (CI mode):

```bash
npm run test:ci
```

Run end-to-end tests (requires `.env.e2e`):

```bash
npm run e2e
```

The suite signs in using Clerk's test-email flow. A dedicated test user is provisioned automatically via the Clerk Backend API (using `NUXT_CLERK_SECRET_KEY`), so no separate Clerk account or credentials are needed.

## Postman

API requests live in `postman/` in Postman's multi-file (Git-integrated) format. Each request, environment, and the workspace globals is a separate YAML file under `postman/collections/`, `postman/environments/`, and `postman/globals/`. This is the format the [Postman VS Code extension](https://marketplace.visualstudio.com/items?itemName=Postman.postman-for-vscode) reads directly — it is **not** a single `.postman_collection.json` file that the desktop app's **File → Import** dialog can open.

### Opening the collection

Use the [Postman VS Code extension](https://marketplace.visualstudio.com/items?itemName=Postman.postman-for-vscode):

1. Install the **Postman** extension in VS Code and sign in.
2. Open this repository as a folder in VS Code.
3. In the Postman panel, the `api` collection under `postman/collections/api/` is detected automatically. Pick the `Local` or `Production` environment (from `postman/environments/`) and send requests.

The `apiToken` workspace global lives in `postman/globals/workspace.globals.yaml`.

### Variables

The collection uses bearer token auth via the `{{apiToken}}` workspace global. Two environments are included — `Local` and `Production` — that control `baseUrl`:

| Variable   | Location          | Description                                                                                                                                                                                                                             |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`  | Environment       | Base URL for the API (`http://localhost:3000` for Local; production URL for Production)                                                                                                                                                 |
| `apiToken` | Workspace globals | Clerk session JWT sent in `Authorization: Bearer <token>` — obtain from [Clerk Dashboard](https://dashboard.clerk.com) → your user → **Sessions** → copy the session access token, or retrieve it in-app via `await session.getToken()` |

Fill in `apiToken` in your workspace globals directly in your Postman client (it is intentionally left blank in the repo). The value is validated server-side by `clerkClient.verifyToken()` in `server/middleware/auth.ts` — it must be a valid Clerk-issued JWT, not the server secret key.

> **Note:** The Production environment's `baseUrl` is currently a placeholder (`https://markpost.example.com`). Update it to the actual deployed URL once known.

## Linting

Check for issues:

```bash
npm run lint
```

Auto-fix:

```bash
npm run lint:fix
```

## Security scanning

A deterministic scanner layer guards against committed secrets and vulnerable dependencies, both locally and in CI.

### Secret scanning ([gitleaks](https://github.com/gitleaks/gitleaks))

Rules live in [`.gitleaks.toml`](.gitleaks.toml), which extends the default gitleaks ruleset with checks for Clerk secret keys (`sk_live_`/`sk_test_`) and credentialed Postgres connection strings. Publishable Clerk keys (`pk_*`) are public by design and are not flagged.

- **Locally:** the `.husky/pre-commit` hook scans staged changes and blocks the commit on any finding. Install gitleaks first ([instructions](https://github.com/gitleaks/gitleaks#installing)); if it is not installed, the hook prints a warning and lets the commit through.
- **Run a manual staged scan:**

  ```bash
  gitleaks git --staged --redact --verbose --config .gitleaks.toml
  ```

- **In CI:** the `secret-scan` job in [`.github/workflows/security.yml`](.github/workflows/security.yml) downloads the pinned gitleaks binary, scans the PR commit range on pull requests, and scans full history on push to `main`. It fails the check on any finding.

### Dependency scanning

- **In CI:** the `dependency-audit` job in [`.github/workflows/security.yml`](.github/workflows/security.yml) runs `npm audit`. It fails only on **high** or **critical** advisories and prints moderate/low advisories as a summary.
- **Automated updates:** [`.github/dependabot.yml`](.github/dependabot.yml) opens weekly PRs against `main`, grouping minor and patch bumps into a single PR.

## Build & Preview

```bash
npm run build
npm run preview
```

## Deployment

The app deploys to Netlify automatically on push to `main`. CI runs lint and unit tests before the build. E2e tests run as a separate job after CI passes.

Required repository secrets (Settings → Secrets → Actions):

- `E2E_DATABASE_URL`
- `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NUXT_CLERK_SECRET_KEY`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_PRO_ANNUAL_PRICE_ID` (optional)
