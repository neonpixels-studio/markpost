import type { RecordResource } from "./useRecords";

type RecordEditResponse = {
  data: RecordResource | null;
};

export type RecordEditAttributes = {
  title: string;
  content: string;
};

// Isolates the single-record PATCH request (title/content only — every other
// field on this endpoint has its own established mutation path already) so
// RecordDetailModal.vue can be tested without a real network call, and so
// this is the one place that knows the request/response shape if the
// endpoint's contract changes.
export async function updateRecordContent(
  uuid: string,
  attributes: RecordEditAttributes,
): Promise<RecordResource> {
  const response = await $fetch<RecordEditResponse>(
    `/api/records/${encodeURIComponent(uuid)}`,
    {
      method: "PATCH",
      body: { data: { type: "records", attributes } },
    },
  );

  if (!response.data) {
    throw new Error("Server returned no data for the updated record");
  }

  return response.data;
}
