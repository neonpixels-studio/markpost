// Shared helper for reading the JSON:API-style error detail out of a failed
// $fetch call. Nuxt's $fetch (ofetch) throws a FetchError whose `.data` holds
// the parsed response body, which on this API is always `{ errors: [...] }`
// (see server/utils/errors.ts#apiErrorHandler).
export type ApiFetchError = {
  data?: { errors?: { detail: string }[] };
};

export function extractErrorDetail(error: unknown, fallback: string): string {
  const fetchError = error as ApiFetchError;
  return fetchError?.data?.errors?.[0]?.detail ?? fallback;
}

const NOT_FOUND_STATUS = 404;

// ofetch (Nuxt's $fetch) surfaces a failed request's HTTP status under
// different keys depending on how the error was constructed/wrapped, so
// every 404 check reads all three rather than assuming one shape.
export function isNotFoundError(error: unknown): boolean {
  const fetchError = error as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
  };
  const status =
    fetchError?.statusCode ??
    fetchError?.status ??
    fetchError?.response?.status;
  return status === NOT_FOUND_STATUS;
}
