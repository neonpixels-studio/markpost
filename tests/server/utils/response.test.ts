import { describe, it, expect } from "vitest";
import {
  recordSerializer,
  sourceSerializer,
  userSettingsSerializer,
  paginationMeta,
  paginationLinks,
} from "../../../server/utils/response";

const baseRecord = {
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  userId: "user_abc123",
  title: "Test Post",
  content: "Some content here",
  sourceId: null,
  source: null,
  sourceType: null,
  status: "pending",
  filePath: null,
  tags: null,
  frontmatter: null,
  syncedAt: null,
  errorMessage: null,
};

describe("recordSerializer", () => {
  it("returns the correct JSON API shape for a valid record with required fields only", () => {
    const result = recordSerializer(baseRecord);

    expect(result).toEqual({
      type: "records",
      id: baseRecord.uuid,
      attributes: {
        uuid: baseRecord.uuid,
        createdAt: baseRecord.createdAt,
        userId: baseRecord.userId,
        title: baseRecord.title,
        content: baseRecord.content,
        sourceId: null,
        source: null,
        sourceType: null,
        status: "pending",
        filePath: null,
        tags: null,
        frontmatter: null,
        syncedAt: null,
        errorMessage: null,
      },
      links: {
        self: `/api/records/${baseRecord.uuid}`,
      },
    });
  });

  it("exposes the joined source type when present", () => {
    const recordWithType = {
      ...baseRecord,
      sourceId: "550e8400-e29b-41d4-a716-446655440099",
      source: "My Zapier hook",
      sourceType: "zapier",
    };

    const result = recordSerializer(recordWithType);

    expect(result?.attributes.sourceType).toBe("zapier");
    expect(result?.attributes.source).toBe("My Zapier hook");
  });

  it("defaults sourceType to null when the row was not joined to sources", () => {
    const recordWithoutJoin = {
      ...baseRecord,
      sourceType: undefined,
    };

    const result = recordSerializer(recordWithoutJoin);

    expect(result?.attributes.sourceType).toBeNull();
  });

  it("includes optional fields when present", () => {
    const syncedAt = new Date("2026-06-14T12:00:00Z");
    const recordWithExtras = {
      ...baseRecord,
      sourceId: "550e8400-e29b-41d4-a716-446655440099",
      source: "webhook/github",
      status: "synced",
      filePath: "99-incoming/2026-06-14-deploy.md",
      tags: ["deploy", "github"],
      frontmatter: { date: "2026-06-14", tags: ["deploy"] },
      syncedAt,
      errorMessage: null,
    };

    const result = recordSerializer(recordWithExtras);

    expect(result?.attributes.sourceId).toBe(recordWithExtras.sourceId);
    expect(result?.attributes.source).toBe("webhook/github");
    expect(result?.attributes.status).toBe("synced");
    expect(result?.attributes.filePath).toBe(
      "99-incoming/2026-06-14-deploy.md",
    );
    expect(result?.attributes.tags).toEqual(["deploy", "github"]);
    expect(result?.attributes.frontmatter).toEqual({
      date: "2026-06-14",
      tags: ["deploy"],
    });
    expect(result?.attributes.syncedAt).toEqual(syncedAt);
    expect(result?.attributes.errorMessage).toBeNull();
  });

  it("surfaces errorMessage when status is error", () => {
    const recordWithError = {
      ...baseRecord,
      status: "error",
      errorMessage: "Sync failed: file already exists",
    };

    const result = recordSerializer(recordWithError);

    expect(result?.attributes.status).toBe("error");
    expect(result?.attributes.errorMessage).toBe(
      "Sync failed: file already exists",
    );
  });

  it("returns null for null input", () => {
    expect(recordSerializer(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(recordSerializer(undefined)).toBeNull();
  });
});

const baseSettings = {
  userId: "user_abc123",
  vaultDir: "~/Documents/Vault",
  filenameTemplate: "{{date}}-{{slug}}.md",
  autoSync: true,
  autoDelete: true,
  frontmatter: true,
  conflictStrategy: "suffix",
  theme: "system",
  accentColor: "#a855f7",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

describe("userSettingsSerializer", () => {
  it("returns the correct JSON API shape for valid settings", () => {
    const result = userSettingsSerializer(baseSettings);

    expect(result).toEqual({
      type: "user_settings",
      id: baseSettings.userId,
      attributes: {
        userId: baseSettings.userId,
        vaultDir: baseSettings.vaultDir,
        filenameTemplate: baseSettings.filenameTemplate,
        autoSync: baseSettings.autoSync,
        autoDelete: baseSettings.autoDelete,
        frontmatter: baseSettings.frontmatter,
        conflictStrategy: baseSettings.conflictStrategy,
        theme: baseSettings.theme,
        accentColor: baseSettings.accentColor,
        updatedAt: baseSettings.updatedAt,
      },
      links: { self: "/api/settings" },
    });
  });
});

describe("paginationMeta", () => {
  it("returns total, size, and hasMore", () => {
    const result = paginationMeta({ total: 42, size: 10, hasMore: true });

    expect(result).toEqual({ total: 42, size: 10, hasMore: true });
  });

  it("reflects hasMore false when on the last page", () => {
    const result = paginationMeta({ total: 5, size: 10, hasMore: false });

    expect(result.hasMore).toBe(false);
  });
});

describe("paginationLinks", () => {
  it("builds next link when hasMore is true and afterCursor is set", () => {
    const result = paginationLinks({
      afterCursor: "some-uuid",
      prevCursor: null,
      size: 10,
      hasMore: true,
    });

    expect(result.next).toBe(
      "/api/records?page%5Bafter%5D=some-uuid&page%5Bsize%5D=10",
    );
    expect(result.prev).toBeNull();
  });

  it("returns null for next when hasMore is false", () => {
    const result = paginationLinks({
      afterCursor: "some-uuid",
      prevCursor: null,
      size: 10,
      hasMore: false,
    });

    expect(result.next).toBeNull();
  });

  it("returns null for next when afterCursor is null even if hasMore is true", () => {
    const result = paginationLinks({
      afterCursor: null,
      prevCursor: null,
      size: 10,
      hasMore: true,
    });

    expect(result.next).toBeNull();
  });

  it("builds prev link when prevCursor is set", () => {
    const result = paginationLinks({
      afterCursor: null,
      prevCursor: "prev-uuid",
      size: 10,
      hasMore: false,
    });

    expect(result.prev).toBe(
      "/api/records?page%5Bafter%5D=prev-uuid&page%5Bsize%5D=10",
    );
  });

  it("returns null for prev when prevCursor is null", () => {
    const result = paginationLinks({
      afterCursor: null,
      prevCursor: null,
      size: 10,
      hasMore: false,
    });

    expect(result.prev).toBeNull();
  });
});

const baseSource = {
  uuid: "550e8400-e29b-41d4-a716-446655440001",
  userId: "user_abc123",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  type: "webhook",
  name: "My Webhook",
  provider: null,
  endpointSlug: "wh_8f2a91c4",
  routeFolder: "99-incoming/",
  fieldMapping: null,
  lastHitAt: null,
  recordCount: 0,
};

describe("sourceSerializer", () => {
  it("returns the correct JSON API shape for a valid source", () => {
    const result = sourceSerializer(baseSource);

    expect(result).toEqual({
      type: "sources",
      id: baseSource.uuid,
      attributes: {
        uuid: baseSource.uuid,
        userId: baseSource.userId,
        createdAt: baseSource.createdAt,
        type: baseSource.type,
        name: baseSource.name,
        provider: null,
        providerSecret: null,
        endpointSlug: baseSource.endpointSlug,
        routeFolder: baseSource.routeFolder,
        fieldMapping: null,
        lastHitAt: null,
        recordCount: 0,
      },
      links: {
        self: `/api/sources/${baseSource.uuid}`,
      },
    });
  });

  it("includes optional fields when present", () => {
    const sourceWithExtras = {
      ...baseSource,
      provider: "stripe",
      fieldMapping: { event: "$.type" },
      lastHitAt: new Date("2024-02-01T12:00:00Z"),
      recordCount: 42,
    };

    const result = sourceSerializer(sourceWithExtras);

    expect(result?.attributes.provider).toBe("stripe");
    expect(result?.attributes.fieldMapping).toEqual({ event: "$.type" });
    expect(result?.attributes.lastHitAt).toEqual(
      new Date("2024-02-01T12:00:00Z"),
    );
    expect(result?.attributes.recordCount).toBe(42);
  });

  it("defaults providerSecret to null when the source row has none", () => {
    const result = sourceSerializer(baseSource);
    expect(result?.attributes.providerSecret).toBeNull();
  });

  it("hides providerSecret by default even when the source row has one (list/patch callers)", () => {
    const sourceWithSecret = {
      ...baseSource,
      provider: "github",
      providerSecret: "a1b2c3",
    };

    const result = sourceSerializer(sourceWithSecret);

    expect(result?.attributes.providerSecret).toBeNull();
  });

  it("reveals providerSecret only when the caller opts in via revealProviderSecret", () => {
    const sourceWithSecret = {
      ...baseSource,
      provider: "github",
      providerSecret: "a1b2c3",
    };

    const result = sourceSerializer(sourceWithSecret, {
      revealProviderSecret: true,
    });

    expect(result?.attributes.providerSecret).toBe("a1b2c3");
  });

  it("returns null for null input", () => {
    expect(sourceSerializer(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(sourceSerializer(undefined)).toBeNull();
  });
});
