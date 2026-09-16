import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateRecordContent } from "../../app/composables/useRecordEdit";
import type { RecordResource } from "../../app/composables/useRecords";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

function makeRecordResource(
  overrides: Partial<RecordResource["attributes"]> = {},
): RecordResource {
  return {
    type: "records",
    id: "uuid-1",
    attributes: {
      uuid: "uuid-1",
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: "Fixed title",
      content: "Fixed content",
      sourceId: null,
      source: null,
      sourceType: null,
      status: "synced",
      filePath: null,
      tags: null,
      frontmatter: null,
      syncedAt: null,
      errorMessage: null,
      ...overrides,
    },
    links: { self: "/api/records/uuid-1" },
  };
}

describe("updateRecordContent", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("PATCHes the record with the title/content attributes", async () => {
    const updated = makeRecordResource();
    mockFetch.mockResolvedValue({ data: updated });

    const result = await updateRecordContent("uuid-1", {
      title: "Fixed title",
      content: "Fixed content",
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/records/uuid-1", {
      method: "PATCH",
      body: {
        data: {
          type: "records",
          attributes: { title: "Fixed title", content: "Fixed content" },
        },
      },
    });
    expect(result).toEqual(updated);
  });

  it("URL-encodes the uuid in the request path", async () => {
    mockFetch.mockResolvedValue({ data: makeRecordResource() });

    await updateRecordContent("uuid with space", {
      title: "t",
      content: "c",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/records/uuid%20with%20space",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("throws when the server returns no data", async () => {
    mockFetch.mockResolvedValue({ data: null });

    await expect(
      updateRecordContent("uuid-1", { title: "t", content: "c" }),
    ).rejects.toThrow("Server returned no data for the updated record");
  });

  it("propagates a fetch rejection (e.g. a 422 validation error)", async () => {
    const validationError = Object.assign(new Error("FetchError"), {
      data: { errors: [{ detail: "Title must be a non-empty string" }] },
    });
    mockFetch.mockRejectedValue(validationError);

    await expect(
      updateRecordContent("uuid-1", { title: "", content: "c" }),
    ).rejects.toBe(validationError);
  });
});
