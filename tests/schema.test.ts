import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { events, records, sources, subscriptions } from "../server/db/schema";

const RECORDS_SOURCE_FK = "records_source_id_sources_uuid_fk";
const RECORDS_USER_CREATED_INDEX = "records_user_id_created_at_idx";
// Resolved from the repo root (vitest's cwd), matching the convention in
// scripts/check-migration-snapshots.ts: import.meta.url is not a plain file://
// URL under vitest's SSR transform, so a URL-relative path throws here.
const MIGRATIONS_DIR = join(process.cwd(), "server/db/migrations");

// Locate the migration by content, not by number: a rebase behind another
// branch that also lands 0014 renumbers this file, and pinning the name would
// then fail with a misleading ENOENT.
function migrationCreatingUserCreatedIndex(): string {
  const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.endsWith(".sql"),
  );
  const match = sqlFiles
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    .find((sql) => sql.includes(RECORDS_USER_CREATED_INDEX));
  if (!match) {
    throw new Error(
      `No migration in ${MIGRATIONS_DIR} creates ${RECORDS_USER_CREATED_INDEX}`,
    );
  }
  return match;
}

function recordsSourceForeignKey() {
  const foreignKeys = getTableConfig(records).foreignKeys;
  return foreignKeys.find((key) => key.getName() === RECORDS_SOURCE_FK);
}

function recordsUserCreatedIndex() {
  const { indexes } = getTableConfig(records);
  return indexes.find(
    (index) => index.config.name === RECORDS_USER_CREATED_INDEX,
  );
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

  // See records_user_id_created_at_idx in schema.ts for why the columns and
  // their nulls ordering are what they are.
  it("has a composite (user_id, created_at desc, uuid desc) index", () => {
    const index = recordsUserCreatedIndex();
    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(false);

    const columns = (index?.config.columns ?? []).map((column) => ({
      name: (column as { name: string }).name,
      order: (column as { indexConfig?: { order?: string } }).indexConfig
        ?.order,
      nulls: (column as { indexConfig?: { nulls?: string } }).indexConfig
        ?.nulls,
    }));
    expect(columns).toEqual([
      { name: "user_id", order: "asc", nulls: "last" },
      { name: "created_at", order: "desc", nulls: "first" },
      { name: "uuid", order: "desc", nulls: "first" },
    ]);
  });

  // The unit test above only proves schema.ts is correct; this guards the
  // migration that actually creates the index in the database against drift,
  // including the load-bearing NULLS FIRST (see schema.ts) and the target table.
  it("ships a migration creating the composite index with NULLS FIRST", () => {
    const migration = migrationCreatingUserCreatedIndex();
    expect(migration).toContain(
      'ON "records" USING btree ("user_id","created_at" DESC NULLS FIRST,"uuid" DESC NULLS FIRST)',
    );
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
