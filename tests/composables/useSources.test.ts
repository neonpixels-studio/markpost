import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEndpointUrl,
  formatLastHit,
  buildSourceMeta,
  sourceActivityStatus,
  useSources,
} from "../../app/composables/useSources";
import type {
  SourceAttributes,
  SourceResource,
} from "../../app/composables/useSources";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

describe("buildEndpointUrl", () => {
  it("returns email address format for email type", () => {
    const url = buildEndpointUrl("email", "clip-ab12");
    expect(url).toBe("clip-ab12@in.markpost.io");
  });

  it("returns webhook ingest URL for webhook type", () => {
    const url = buildEndpointUrl("webhook", "wh_abc12345");
    expect(url).toBe("https://ingest.markpost.io/v1/hooks/wh_abc12345");
  });

  it("returns webhook ingest URL for preset types (stripe, github, etc.)", () => {
    expect(buildEndpointUrl("stripe", "wh_stripe01")).toBe(
      "https://ingest.markpost.io/v1/hooks/wh_stripe01",
    );
    expect(buildEndpointUrl("github", "wh_ghub01ab")).toBe(
      "https://ingest.markpost.io/v1/hooks/wh_ghub01ab",
    );
  });
});

describe("formatLastHit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'never hit' when lastHitAt is null", () => {
    expect(formatLastHit(null)).toBe("never hit");
  });

  it("returns 'just now' for hits within the last minute", () => {
    const recentHit = new Date("2026-01-01T11:59:30Z").toISOString();
    expect(formatLastHit(recentHit)).toBe("last hit just now");
  });

  it("returns minutes ago for hits within the last hour", () => {
    const thirtyMinutesAgo = new Date("2026-01-01T11:30:00Z").toISOString();
    expect(formatLastHit(thirtyMinutesAgo)).toBe("last hit 30m ago");
  });

  it("returns hours ago for hits within the last day", () => {
    const threeHoursAgo = new Date("2026-01-01T09:00:00Z").toISOString();
    expect(formatLastHit(threeHoursAgo)).toBe("last hit 3h ago");
  });

  it("returns days ago for hits older than one day", () => {
    const twoDaysAgo = new Date("2025-12-30T12:00:00Z").toISOString();
    expect(formatLastHit(twoDaysAgo)).toBe("last hit 2d ago");
  });
});

describe("buildSourceMeta", () => {
  const baseAttributes: SourceAttributes = {
    uuid: "abc-123",
    userId: "user-1",
    createdAt: "2026-01-01T10:00:00Z",
    type: "webhook",
    name: "Webhook endpoint",
    provider: null,
    endpointSlug: "wh_abc12345",
    routeFolder: "99-incoming/",
    fieldMapping: null,
    lastHitAt: null,
    recordCount: 0,
  };

  it("returns three meta items in correct order", () => {
    const meta = buildSourceMeta(baseAttributes);
    expect(meta).toHaveLength(3);
  });

  it("uses singular 'record' when count is 1", () => {
    const attributes = { ...baseAttributes, recordCount: 1 };
    const [recordLabel] = buildSourceMeta(attributes);
    expect(recordLabel).toBe("1 record");
  });

  it("uses plural 'records' when count is 0", () => {
    const attributes = { ...baseAttributes, recordCount: 0 };
    const [recordLabel] = buildSourceMeta(attributes);
    expect(recordLabel).toBe("0 records");
  });

  it("uses plural 'records' when count is greater than 1", () => {
    const attributes = { ...baseAttributes, recordCount: 142 };
    const [recordLabel] = buildSourceMeta(attributes);
    expect(recordLabel).toBe("142 records");
  });

  it("includes the route folder in meta", () => {
    const attributes = { ...baseAttributes, routeFolder: "work/notes/" };
    const meta = buildSourceMeta(attributes);
    expect(meta[2]).toBe("routes to work/notes/");
  });

  it("shows 'never hit' when lastHitAt is null", () => {
    const meta = buildSourceMeta(baseAttributes);
    expect(meta[1]).toBe("never hit");
  });
});

describe("sourceActivityStatus", () => {
  const baseAttributes: SourceAttributes = {
    uuid: "abc-123",
    userId: "user-1",
    createdAt: "2026-01-01T10:00:00Z",
    type: "webhook",
    name: "Webhook endpoint",
    provider: null,
    endpointSlug: "wh_abc12345",
    routeFolder: "99-incoming/",
    fieldMapping: null,
    lastHitAt: null,
    recordCount: 0,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is 'active' (ok) when the source delivered within the active window", () => {
    const recentHit = new Date("2026-01-14T12:00:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      lastHitAt: recentHit,
    });
    expect(status).toEqual({ tone: "ok", label: "active" });
  });

  it("is 'quiet' (warn) when the last delivery is older than the active window", () => {
    const staleHit = new Date("2025-12-01T00:00:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      lastHitAt: staleHit,
    });
    expect(status).toEqual({ tone: "warn", label: "quiet" });
  });

  it("is 'quiet' at exactly the active-window boundary (exclusive)", () => {
    const exactlySevenDaysAgo = new Date("2026-01-08T12:00:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      lastHitAt: exactlySevenDaysAgo,
    });
    expect(status).toEqual({ tone: "warn", label: "quiet" });
  });

  it("degrades to 'quiet' when lastHitAt is present but unparseable", () => {
    const status = sourceActivityStatus({
      ...baseAttributes,
      lastHitAt: "not-a-date",
    });
    expect(status).toEqual({ tone: "warn", label: "quiet" });
  });

  it("is 'ready' (accent) for a just-created source that has never delivered", () => {
    const justCreated = new Date("2026-01-15T11:58:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: justCreated,
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "accent", label: "ready" });
  });

  it("prefers real delivery over age: a recently-hit brand-new source is 'active'", () => {
    const justCreated = new Date("2026-01-15T11:58:00Z").toISOString();
    const recentHit = new Date("2026-01-15T11:59:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: justCreated,
      lastHitAt: recentHit,
    });
    expect(status).toEqual({ tone: "ok", label: "active" });
  });

  it("is a neutral 'waiting' once past the new window but still within the active window", () => {
    const twoDaysAgo = new Date("2026-01-13T12:00:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: twoDaysAgo,
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "", label: "waiting" });
  });

  it("is 'waiting' (not a warning) at exactly the new-window boundary", () => {
    const exactlyFiveMinutesAgo = new Date(
      "2026-01-15T11:55:00Z",
    ).toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: exactlyFiveMinutesAgo,
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "", label: "waiting" });
  });

  it("is 'idle' (warn) only once a whole active window has passed with no delivery", () => {
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: "2025-01-01T00:00:00Z",
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "warn", label: "idle" });
  });

  it("is 'idle' at exactly the active-window boundary for an undelivered source (exclusive)", () => {
    const exactlySevenDaysAgo = new Date("2026-01-08T12:00:00Z").toISOString();
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: exactlySevenDaysAgo,
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "warn", label: "idle" });
  });

  it("is 'idle' when createdAt is unparseable and there is no delivery", () => {
    const status = sourceActivityStatus({
      ...baseAttributes,
      createdAt: "not-a-date",
      lastHitAt: null,
    });
    expect(status).toEqual({ tone: "warn", label: "idle" });
  });
});

function makeSourceResource(
  overrides: Partial<SourceResource> = {},
): SourceResource {
  return {
    type: "sources",
    id: "resource-id",
    attributes: {
      uuid: "attributes-uuid",
      userId: "user-1",
      createdAt: "2025-01-01T00:00:00Z",
      type: "webhook",
      name: "Webhook endpoint",
      provider: null,
      endpointSlug: "wh_abc12345",
      routeFolder: "99-incoming/",
      fieldMapping: null,
      lastHitAt: null,
      recordCount: 0,
    },
    links: { self: "/api/sources/attributes-uuid" },
    ...overrides,
  };
}

describe("useSources", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("loadSources", () => {
    it("populates sources from the API response", async () => {
      const source = makeSourceResource();
      mockFetch.mockResolvedValue({ data: [source] });
      const { sources, loadSources } = useSources();
      await loadSources();
      expect(sources.value).toHaveLength(1);
      expect(sources.value[0].id).toBe("resource-id");
    });

    it("sets isLoading to false after success", async () => {
      mockFetch.mockResolvedValue({ data: [] });
      const { isLoading, loadSources } = useSources();
      await loadSources();
      expect(isLoading.value).toBe(false);
    });

    it("sets isLoading to false after failure", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const { isLoading, loadSources } = useSources();
      await expect(loadSources()).rejects.toThrow("network error");
      expect(isLoading.value).toBe(false);
    });

    it("propagates fetch errors to the caller", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const { loadSources } = useSources();
      await expect(loadSources()).rejects.toThrow("network error");
    });
  });

  describe("removeSource", () => {
    it("removes the source from the list by attributes.uuid (not source.id)", async () => {
      mockFetch.mockResolvedValue({});
      const source = makeSourceResource({
        id: "resource-id",
        attributes: {
          uuid: "attributes-uuid",
          userId: "user-1",
          createdAt: "2025-01-01T00:00:00Z",
          type: "webhook",
          name: "Webhook endpoint",
          provider: null,
          endpointSlug: "wh_abc12345",
          routeFolder: "99-incoming/",
          fieldMapping: null,
          lastHitAt: null,
          recordCount: 0,
        },
      });
      const { sources, removeSource } = useSources();
      sources.value = [source];
      await removeSource("attributes-uuid");
      expect(sources.value).toHaveLength(0);
    });

    it("calls DELETE with the correct uuid", async () => {
      mockFetch.mockResolvedValue({});
      const { sources, removeSource } = useSources();
      sources.value = [makeSourceResource()];
      await removeSource("attributes-uuid");
      expect(mockFetch).toHaveBeenCalledWith("/api/sources/attributes-uuid", {
        method: "DELETE",
      });
    });

    it("propagates delete errors to the caller", async () => {
      mockFetch.mockRejectedValue(new Error("delete failed"));
      const { sources, removeSource } = useSources();
      sources.value = [makeSourceResource()];
      await expect(removeSource("attributes-uuid")).rejects.toThrow(
        "delete failed",
      );
    });
  });

  describe("rotateSecret", () => {
    it("POSTs to the rotate-secret endpoint with no body for generated providers", async () => {
      const rotated = makeSourceResource({
        attributes: {
          uuid: "attributes-uuid",
          userId: "user-1",
          createdAt: "2025-01-01T00:00:00Z",
          type: "github",
          name: "GitHub",
          provider: "github",
          providerSecret: "fresh-generated-secret",
          endpointSlug: "wh_ghub01ab",
          routeFolder: "99-incoming/",
          fieldMapping: null,
          lastHitAt: null,
          recordCount: 0,
        },
      });
      mockFetch.mockResolvedValue({ data: rotated });
      const { sources, rotateSecret } = useSources();
      sources.value = [makeSourceResource({ id: "attributes-uuid" })];

      const result = await rotateSecret("attributes-uuid");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/sources/attributes-uuid/rotate-secret",
        { method: "POST", body: undefined },
      );
      expect(result.attributes.providerSecret).toBe("fresh-generated-secret");
    });

    it("sends the supplied secret in the body for manual providers", async () => {
      const rotated = makeSourceResource({
        attributes: {
          uuid: "attributes-uuid",
          userId: "user-1",
          createdAt: "2025-01-01T00:00:00Z",
          type: "stripe",
          name: "Stripe",
          provider: "stripe",
          providerSecret: null,
          endpointSlug: "wh_stripe01",
          routeFolder: "99-incoming/",
          fieldMapping: null,
          lastHitAt: null,
          recordCount: 0,
        },
      });
      mockFetch.mockResolvedValue({ data: rotated });
      const { sources, rotateSecret } = useSources();
      sources.value = [makeSourceResource({ id: "attributes-uuid" })];

      await rotateSecret("attributes-uuid", "whsec_new_value");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/sources/attributes-uuid/rotate-secret",
        {
          method: "POST",
          body: {
            data: {
              type: "sources",
              attributes: { providerSecret: "whsec_new_value" },
            },
          },
        },
      );
    });

    it("never retains the revealed secret in the reactive list", async () => {
      const existing = makeSourceResource({
        attributes: {
          uuid: "attributes-uuid",
          userId: "user-1",
          createdAt: "2025-01-01T00:00:00Z",
          type: "github",
          name: "GitHub",
          provider: "github",
          providerSecret: null,
          endpointSlug: "wh_ghub01ab",
          routeFolder: "99-incoming/",
          fieldMapping: null,
          lastHitAt: null,
          recordCount: 0,
        },
      });
      const rotated = {
        ...existing,
        attributes: {
          ...existing.attributes,
          providerSecret: "fresh-generated-secret",
        },
      };
      mockFetch.mockResolvedValue({ data: rotated });
      const { sources, rotateSecret } = useSources();
      sources.value = [existing];

      await rotateSecret("attributes-uuid");

      expect(sources.value[0].attributes.providerSecret).toBeNull();
    });

    it("throws when the server returns no data", async () => {
      mockFetch.mockResolvedValue({ data: null });
      const { rotateSecret } = useSources();
      await expect(rotateSecret("attributes-uuid")).rejects.toThrow(
        "Server returned no data",
      );
    });

    it("throws when the rotated source is no longer in the list", async () => {
      const rotated = makeSourceResource({ id: "gone" });
      rotated.attributes.uuid = "gone";
      mockFetch.mockResolvedValue({ data: rotated });
      const { sources, rotateSecret } = useSources();
      sources.value = [];
      await expect(rotateSecret("gone")).rejects.toThrow(
        "no longer in the list",
      );
    });

    it("propagates rotate errors to the caller", async () => {
      mockFetch.mockRejectedValue(new Error("rotate failed"));
      const { rotateSecret } = useSources();
      await expect(rotateSecret("attributes-uuid")).rejects.toThrow(
        "rotate failed",
      );
    });
  });
});
