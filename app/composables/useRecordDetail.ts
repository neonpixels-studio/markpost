import type { RecordResource } from "./useRecords";

const NOT_FOUND_STATUS = 404;
const RECORD_MISSING_MESSAGE = "Record not found. It may have been removed.";
const RECORD_LOAD_FAILED_MESSAGE = "Failed to load record. Please try again.";

type RecordDetailResponse = {
  data: RecordResource | null;
};

function isNotFoundError(error: unknown): boolean {
  const candidate = error as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
  };
  const status =
    candidate?.statusCode ?? candidate?.status ?? candidate?.response?.status;
  return status === NOT_FOUND_STATUS;
}

export async function fetchRecord(
  uuid: string,
): Promise<RecordResource | null> {
  const response = await $fetch<RecordDetailResponse>(
    `/api/records/${encodeURIComponent(uuid)}`,
  );
  return response.data ?? null;
}

export function useRecordDetail() {
  const record = ref<RecordResource | null>(null);
  const isLoading = ref(false);
  const loadError = ref<string | null>(null);

  // A slow request for record A must not overwrite a newer request for record
  // B. Each call claims the latest id; stale responses are dropped.
  let latestRequestId = 0;

  async function open(uuid: string): Promise<void> {
    const requestId = ++latestRequestId;
    isLoading.value = true;
    loadError.value = null;
    record.value = null;

    try {
      const fetched = await fetchRecord(uuid);
      if (requestId !== latestRequestId) {
        return;
      }
      record.value = fetched;
      if (!fetched) {
        loadError.value = RECORD_MISSING_MESSAGE;
      }
    } catch (fetchError) {
      if (requestId !== latestRequestId) {
        return;
      }
      // ofetch throws on non-2xx, so a real 404 lands here, not the null
      // branch above. Distinguish "removed" from a transient failure.
      if (isNotFoundError(fetchError)) {
        loadError.value = RECORD_MISSING_MESSAGE;
        return;
      }
      console.error("[useRecordDetail] open error:", fetchError);
      loadError.value = RECORD_LOAD_FAILED_MESSAGE;
    } finally {
      if (requestId === latestRequestId) {
        isLoading.value = false;
      }
    }
  }

  function close(): void {
    // Invalidate any in-flight open() so its late response can't repopulate a
    // closed modal.
    latestRequestId += 1;
    record.value = null;
    loadError.value = null;
    isLoading.value = false;
  }

  // Lets a caller that already fetched a fresher copy of the currently open
  // record (e.g. after a status-changing PATCH elsewhere) push it into the
  // modal without a redundant re-fetch. Guarded by uuid so a response for a
  // record that's no longer the open one can't clobber the modal.
  function applyUpdate(updated: RecordResource): void {
    if (record.value?.attributes.uuid !== updated.attributes.uuid) {
      return;
    }
    record.value = updated;
  }

  return {
    record,
    isLoading,
    loadError,
    open,
    close,
    applyUpdate,
  };
}
