import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { events, records, sources, subscriptions } from "../server/db/schema";

const RECORDS_SOURCE_FK = "records_source_id_sources_uuid_fk";
const EVENTS_SOURCE_FK = "events_source_id_sources_uuid_fk";

function recordsSourceForeignKey() {
  const foreignKeys = getTableConfig(records).foreignKeys;
  return foreignKeys.find((key) => key.getName() === RECORDS_SOURCE_FK);
}

function eventsSourceForeignKey() {
  const foreignKeys = getTableConfig(events).foreignKeys;
  return foreignKeys.find((key) => key.getName() === EVENTS_SOURCE_FK);
}

describe("records schema", () => {
  it("includes a userId column", () => {
    expect(records.userId).toBeDefined();
  });

  it("userId column is not nullable", () => {
    expect(records.userId.notNull).toBe(true);
  });

  it("userId column maps to user_id in the database", () => {
    expect(records.userId.name).toBe("user_id");
  });

  it("includes a nullable sourceId column mapped to source_id", () => {
    expect(records.sourceId).toBeDefined();
    expect(records.sourceId.name).toBe("source_id");
    expect(records.sourceId.notNull).toBe(false);
  });

  it("includes a nullable source column", () => {
    expect(records.source).toBeDefined();
    expect(records.source.notNull).toBe(false);
  });

  // Regression for #168: deleting a source that has ingested records used to
  // raise a Postgres 23503 FK violation (surfaced as a 500) because the
  // source_id FK was ON DELETE NO ACTION. SET NULL lets the delete succeed
  // and orphans the records (the records list already tolerates NULL sourceId).
  it("source_id foreign key deletes with ON DELETE SET NULL", () => {
    const foreignKey = recordsSourceForeignKey();
    expect(foreignKey).toBeDefined();
    expect(foreignKey?.onDelete).toBe("set null");
  });

  it("status column defaults to pending and is not nullable", () => {
    expect(records.status).toBeDefined();
    expect(records.status.notNull).toBe(true);
    expect(records.status.default).toBe("pending");
  });

  it("includes a nullable filePath column mapped to file_path", () => {
    expect(records.filePath).toBeDefined();
    expect(records.filePath.name).toBe("file_path");
    expect(records.filePath.notNull).toBe(false);
  });

  it("includes a nullable tags jsonb column", () => {
    expect(records.tags).toBeDefined();
    expect(records.tags.columnType).toBe("PgJsonb");
  });

  it("includes a nullable frontmatter jsonb column", () => {
    expect(records.frontmatter).toBeDefined();
    expect(records.frontmatter.columnType).toBe("PgJsonb");
  });

  it("includes a nullable syncedAt timestamp column mapped to synced_at", () => {
    expect(records.syncedAt).toBeDefined();
    expect(records.syncedAt.name).toBe("synced_at");
    expect(records.syncedAt.notNull).toBe(false);
  });

  it("includes a nullable errorMessage column mapped to error_message", () => {
    expect(records.errorMessage).toBeDefined();
    expect(records.errorMessage.name).toBe("error_message");
    expect(records.errorMessage.notNull).toBe(false);
  });
});

describe("sources schema", () => {
  it("includes a uuid primary key column", () => {
    expect(sources.uuid).toBeDefined();
  });

  it("includes a userId column mapped to user_id", () => {
    expect(sources.userId.name).toBe("user_id");
  });

  it("userId column is not nullable", () => {
    expect(sources.userId.notNull).toBe(true);
  });

  it("includes an endpointSlug column mapped to endpoint_slug", () => {
    expect(sources.endpointSlug.name).toBe("endpoint_slug");
  });

  it("includes a routeFolder column mapped to route_folder", () => {
    expect(sources.routeFolder.name).toBe("route_folder");
  });

  it("includes a nullable provider column", () => {
    expect(sources.provider).toBeDefined();
    expect(sources.provider.notNull).toBe(false);
  });

  it("includes a nullable fieldMapping column mapped to field_mapping", () => {
    expect(sources.fieldMapping.name).toBe("field_mapping");
  });

  it("includes a nullable lastHitAt column mapped to last_hit_at", () => {
    expect(sources.lastHitAt.name).toBe("last_hit_at");
  });

  it("recordCount defaults to 0", () => {
    expect(sources.recordCount.default).toBe(0);
  });
});

describe("events schema", () => {
  it("includes an id uuid primary key column", () => {
    expect(events.id).toBeDefined();
  });

  it("includes a userId column mapped to user_id", () => {
    expect(events.userId.name).toBe("user_id");
  });

  it("userId column is not nullable", () => {
    expect(events.userId.notNull).toBe(true);
  });

  it("includes a ts timestamp column with default now", () => {
    expect(events.ts).toBeDefined();
    expect(events.ts.notNull).toBe(true);
  });

  it("includes a kind column that is not nullable", () => {
    expect(events.kind).toBeDefined();
    expect(events.kind.notNull).toBe(true);
  });

  it("includes a message column that is not nullable", () => {
    expect(events.message).toBeDefined();
    expect(events.message.notNull).toBe(true);
  });

  it("includes a nullable recordUuid column mapped to record_uuid", () => {
    expect(events.recordUuid).toBeDefined();
    expect(events.recordUuid.name).toBe("record_uuid");
    expect(events.recordUuid.notNull).toBe(false);
  });

  it("includes a nullable sourceId column mapped to source_id", () => {
    expect(events.sourceId).toBeDefined();
    expect(events.sourceId.name).toBe("source_id");
    expect(events.sourceId.notNull).toBe(false);
  });

  // Regression for #183: events.source_id had no FK, so deleting a source left
  // rows pointing at a gone sources.uuid and event-to-source lookups silently
  // returned nothing. The FK with ON DELETE SET NULL nulls the reference on
  // delete instead (mirrors the records.source_id FK).
  it("source_id foreign key deletes with ON DELETE SET NULL", () => {
    const foreignKey = eventsSourceForeignKey();
    expect(foreignKey).toBeDefined();
    expect(foreignKey?.onDelete).toBe("set null");
  });
});

describe("subscriptions schema", () => {
  it("includes an id uuid primary key column", () => {
    expect(subscriptions.id).toBeDefined();
  });

  it("includes a userId column mapped to user_id", () => {
    expect(subscriptions.userId.name).toBe("user_id");
  });

  it("userId column is not nullable", () => {
    expect(subscriptions.userId.notNull).toBe(true);
  });

  it("plan defaults to hobby and is not nullable", () => {
    expect(subscriptions.plan).toBeDefined();
    expect(subscriptions.plan.notNull).toBe(true);
    expect(subscriptions.plan.default).toBe("hobby");
  });

  it("status defaults to trialing and is not nullable", () => {
    expect(subscriptions.status).toBeDefined();
    expect(subscriptions.status.notNull).toBe(true);
    expect(subscriptions.status.default).toBe("trialing");
  });

  it("includes a nullable trialEndsAt timestamp column mapped to trial_ends_at", () => {
    expect(subscriptions.trialEndsAt).toBeDefined();
    expect(subscriptions.trialEndsAt.name).toBe("trial_ends_at");
    expect(subscriptions.trialEndsAt.notNull).toBe(false);
  });

  it("includes a nullable stripeCustomerId column mapped to stripe_customer_id", () => {
    expect(subscriptions.stripeCustomerId).toBeDefined();
    expect(subscriptions.stripeCustomerId.name).toBe("stripe_customer_id");
    expect(subscriptions.stripeCustomerId.notNull).toBe(false);
  });

  it("includes a nullable stripeSubscriptionId column mapped to stripe_subscription_id", () => {
    expect(subscriptions.stripeSubscriptionId).toBeDefined();
    expect(subscriptions.stripeSubscriptionId.name).toBe(
      "stripe_subscription_id",
    );
    expect(subscriptions.stripeSubscriptionId.notNull).toBe(false);
  });

  it("includes createdAt and updatedAt timestamp columns", () => {
    expect(subscriptions.createdAt).toBeDefined();
    expect(subscriptions.createdAt.notNull).toBe(true);
    expect(subscriptions.updatedAt).toBeDefined();
    expect(subscriptions.updatedAt.notNull).toBe(true);
  });
});
