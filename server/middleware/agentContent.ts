import {
  MARKDOWN_CONTENT_TYPE,
  NEGOTIATION_VARY,
  isKnownPath,
  notFoundMarkdown,
  wantsMarkdown,
} from "../utils/agentContent";

// Serves agent-facing representations of non-API routes:
//   - A Markdown 404 (with pointers to the sitemap/llms.txt/docs) when a client
//     that negotiates for Markdown hits an unknown path, instead of the soft-200
//     app shell that makes agents believe every path exists.
// HTML clients fall through to the Vue catch-all page, which sets a real 404.
export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") {
    return;
  }

  const path = event.path;
  if (path.startsWith("/api/")) {
    return;
  }

  const accept = getHeader(event, "accept");

  if (wantsMarkdown(accept, path) && !isKnownPath(path)) {
    return new Response(notFoundMarkdown(path), {
      status: 404,
      headers: {
        "content-type": MARKDOWN_CONTENT_TYPE,
        vary: NEGOTIATION_VARY,
      },
    });
  }
});
