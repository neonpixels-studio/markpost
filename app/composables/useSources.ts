import { computeElapsedBuckets } from "../utils/timeBuckets";

const WEBHOOK_INGEST_BASE = "https://ingest.markpost.io/v1/hooks";
const EMAIL_DOMAIN = "in.markpost.io";

export type SourceAttributes = {
  uuid: string;
  userId: string;
  createdAt: string;
  type: string;
  name: string;
  provider: string | null;
  providerSecret?: string | null;
  endpointSlug: string;
  routeFolder: string;
  fieldMapping: unknown;
  lastHitAt: string | null;
  recordCount: number;
};

export type SourceResource = {
  type: "sources";
  id: string;
  attributes: SourceAttributes;
  links: { self: string };
};

type SourceListResponse = {
  data: SourceResource[];
};

type SourceResponse = {
  data: SourceResource | null;
};

export type CreateSourcePayload = {
  type: string;
  name: string;
  routeFolder: string;
  provider?: string;
  // Only sent for manual-secret presets (Stripe — see AddSourceModal's
  // `secretEntry: "manual"`); the server generates its own for GitHub/Zapier/
  // Shortcuts instead.
  providerSecret?: string;
  fieldMapping?: unknown;
};

export function buildEndpointUrl(
  sourceType: string,
  endpointSlug: string,
): string {
  if (sourceType === "email") {
    return `${endpointSlug}@${EMAIL_DOMAIN}`;
  }

  return `${WEBHOOK_INGEST_BASE}/${endpointSlug}`;
}

export function formatLastHit(lastHitAt: string | null): string {
  if (!lastHitAt) {
    return "never hit";
  }

  const buckets = computeElapsedBuckets(lastHitAt);

  if (!buckets) {
    return "last hit —";
  }

  const { seconds, minutes, hours, days } = buckets;

  if (seconds < 60) {
    return "last hit just now";
  }

  if (minutes < 60) {
    return `last hit ${minutes}m ago`;
  }

  if (hours < 24) {
    return `last hit ${hours}h ago`;
  }

  return `last hit ${days}d ago`;
}

export function buildSourceMeta(attributes: SourceAttributes): string[] {
  const recordLabel =
    attributes.recordCount === 1
      ? "1 record"
      : `${attributes.recordCount} records`;

  return [
    recordLabel,
    formatLastHit(attributes.lastHitAt),
    `routes to ${attributes.routeFolder}`,
  ];
}

// A source that delivered within the last week is treated as actively firing;
// past that it has gone quiet and the badge should say so. Compared against the
// bucket's whole-day count, so the boundary is exclusive (day 7 reads "quiet").
const SOURCE_ACTIVE_WINDOW_DAYS = 7;

// A freshly created source has no deliveries yet, so for its first few minutes
// "no activity" is expected rather than a problem.
const SOURCE_NEW_WINDOW_MINUTES = 5;

export type SourceActivityStatus = {
  tone: "" | "ok" | "warn" | "accent";
  label: "active" | "quiet" | "ready" | "waiting" | "idle";
};

// A source that has ever delivered is either firing ("active") or has gone
// silent ("quiet"). An unparseable timestamp still means it delivered, so it
// degrades to "quiet" rather than pretending it never fired.
function deliveredActivityStatus(lastHitAt: string): SourceActivityStatus {
  const sinceLastHit = computeElapsedBuckets(lastHitAt);
  if (sinceLastHit && sinceLastHit.days < SOURCE_ACTIVE_WINDOW_DAYS) {
    return { tone: "ok", label: "active" };
  }
  return { tone: "warn", label: "quiet" };
}

// A source that has never delivered moves through three states so the warning
// tone is reserved for a genuinely abandoned source, not one still being wired
// up: "ready" for its first few minutes, then a neutral "waiting" while a first
// delivery is still plausible, and only "idle" (warn) once a source has sat a
// whole active window with nothing arriving. An unparseable createdAt can't be
// vouched for, so it falls through to "idle".
function undeliveredActivityStatus(createdAt: string): SourceActivityStatus {
  const sinceCreated = computeElapsedBuckets(createdAt);
  if (sinceCreated && sinceCreated.minutes < SOURCE_NEW_WINDOW_MINUTES) {
    return { tone: "accent", label: "ready" };
  }
  if (sinceCreated && sinceCreated.days < SOURCE_ACTIVE_WINDOW_DAYS) {
    return { tone: "", label: "waiting" };
  }
  return { tone: "warn", label: "idle" };
}

// The status badge reflects whether the webhook is actually firing, derived
// from real delivery activity rather than the source's age alone. It is a pure
// read of the source's timestamps: consumers recompute it when the source prop
// changes or the card re-renders, not on a timer, so a "ready" card only flips
// to "idle" on the next render rather than the instant the window elapses.
export function sourceActivityStatus(
  attributes: SourceAttributes,
): SourceActivityStatus {
  if (attributes.lastHitAt) {
    return deliveredActivityStatus(attributes.lastHitAt);
  }
  return undeliveredActivityStatus(attributes.createdAt);
}

async function fetchSources(): Promise<SourceResource[]> {
  const response = await $fetch<SourceListResponse>("/api/sources");
  return response.data ?? [];
}

async function createSource(
  payload: CreateSourcePayload,
): Promise<SourceResource> {
  const response = await $fetch<SourceResponse>("/api/sources", {
    method: "POST",
    body: {
      data: {
        type: "sources",
        attributes: payload,
      },
    },
  });

  if (!response.data) {
    throw new Error("Server returned no data for the created source");
  }

  return response.data;
}

async function deleteSource(uuid: string): Promise<void> {
  await $fetch(`/api/sources/${uuid}`, { method: "DELETE" });
}

// Rotates a source's provider secret. For generated-secret providers
// (github/zapier/shortcuts) no body is sent and the response reveals the fresh
// secret exactly once; for manual-secret providers (stripe) the caller passes
// the new value the provider issued. Mirrors createSource: the response is the
// one and only place the revealed secret appears.
async function rotateSourceSecret(
  uuid: string,
  providerSecret?: string,
): Promise<SourceResource> {
  const body =
    providerSecret === undefined
      ? undefined
      : { data: { type: "sources", attributes: { providerSecret } } };

  const response = await $fetch<SourceResponse>(
    `/api/sources/${uuid}/rotate-secret`,
    { method: "POST", body },
  );

  if (!response.data) {
    throw new Error("Server returned no data for the rotated source");
  }

  return response.data;
}

export function useSources() {
  const sources = ref<SourceResource[]>([]);
  const isLoading = ref(false);

  async function loadSources(): Promise<void> {
    isLoading.value = true;

    try {
      sources.value = await fetchSources();
    } finally {
      isLoading.value = false;
    }
  }

  async function addSource(
    payload: CreateSourcePayload,
  ): Promise<SourceResource> {
    const created = await createSource(payload);
    // The create response reveals providerSecret exactly once (see
    // server/utils/response.ts's revealProviderSecret option) so the caller
    // can show it — but `sources` backs the persistent list UI (SourceCard),
    // which must never hold onto it: GET/PATCH always null it out, and the
    // reactive list should match that for the rest of the session too.
    sources.value = [
      ...sources.value,
      {
        ...created,
        attributes: { ...created.attributes, providerSecret: null },
      },
    ];
    return created;
  }

  async function removeSource(uuid: string): Promise<void> {
    await deleteSource(uuid);
    sources.value = sources.value.filter(
      (source) => source.attributes.uuid !== uuid,
    );
  }

  async function rotateSecret(
    uuid: string,
    providerSecret?: string,
  ): Promise<SourceResource> {
    const rotated = await rotateSourceSecret(uuid, providerSecret);
    // Fail loud rather than reporting a rotation the list never reflected: if
    // the entry vanished between opening the flow and the response (a parallel
    // loadSources replacing the array, a delete in another tab), the caller
    // would otherwise advance to the reveal step over stale state.
    const index = sources.value.findIndex(
      (source) => source.attributes.uuid === uuid,
    );
    if (index === -1) {
      throw new Error(`Rotated source ${uuid} is no longer in the list`);
    }
    // Same rule as addSource: the reactive list backs SourceCard, which must
    // never retain the one-time revealed secret. Refresh the entry from the
    // response but null the secret out.
    sources.value = sources.value.map((source) =>
      source.attributes.uuid === uuid
        ? {
            ...rotated,
            attributes: { ...rotated.attributes, providerSecret: null },
          }
        : source,
    );
    return rotated;
  }

  return {
    sources,
    isLoading,
    loadSources,
    addSource,
    removeSource,
    rotateSecret,
  };
}
