import {
  MARKDOWN_CONTENT_TYPE,
  NEGOTIATION_VARY,
  isKnownPath,
  markdownForRoute,
  normalizePath,
  notFoundMarkdown,
  resolveMarkdownRoute,
  wantsMarkdown,
} from "../utils/agentContent";
import {
  PROTECTED_RESOURCE_CONTENT_TYPE,
  PROTECTED_RESOURCE_PATH,
  buildProtectedResourceMetadata,
} from "../utils/protectedResource";
import { buildAppUrl } from "../utils/appUrl";

// Resolve the configured app URL, or null when it cannot be resolved, so an
// agent route degrades instead of throwing a 500 on a misconfigured deploy. The
// failure is logged loudly rather than swallowed. This is the only place the
// middleware reads config.
function resolveConfiguredAppUrl(): string | null {
  try {
    return buildAppUrl();
  } catch (error) {
    console.error("[agentContent] app URL unresolved", error);
    return null;
  }
}

// Serves agent-facing representations of non-API routes:
//   - RFC 9728 protected-resource metadata (the API's supported OAuth scopes) at
//     /.well-known/oauth-protected-resource.
//   - A Markdown representation of the main content pages (/, /docs, /pricing)
//     when a client negotiates for it (Accept: text/markdown, or a .md suffix).
//   - A Markdown 404 (with pointers to the sitemap/llms.txt/docs) when a client
//     that negotiates for Markdown hits an unknown path, instead of the soft-200
//     app shell that makes agents believe every path exists.
// The HTML variant of a content page advertises `Vary: Accept` so a cache never
// serves HTML to a Markdown-negotiating client (and vice versa).
// HTML clients hitting an unknown path fall through to the Vue catch-all page,
// which sets a real 404.
export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") {
    return;
  }

  const path = event.path;
  if (path.startsWith("/api/")) {
    return;
  }

  if (normalizePath(path) === PROTECTED_RESOURCE_PATH) {
    const appUrl = resolveConfiguredAppUrl();
    if (!appUrl) {
      // A metadata endpoint must not soft-fall-through to the HTML app shell:
      // signal the misconfiguration so integrations surface it loudly.
      return new Response(
        JSON.stringify({
          error: "server_error",
          error_description: "app URL is not configured",
        }),
        {
          status: 503,
          headers: { "content-type": PROTECTED_RESOURCE_CONTENT_TYPE },
        },
      );
    }

    return new Response(
      JSON.stringify(buildProtectedResourceMetadata(appUrl)),
      {
        status: 200,
        headers: { "content-type": PROTECTED_RESOURCE_CONTENT_TYPE },
      },
    );
  }

  const accept = getHeader(event, "accept");
  const isContentRoute = resolveMarkdownRoute(path) !== null;

  if (wantsMarkdown(accept, path)) {
    const appUrl = resolveConfiguredAppUrl();
    const markdown = appUrl ? markdownForRoute(path, appUrl) : null;
    if (markdown) {
      return new Response(markdown, {
        status: 200,
        headers: {
          "content-type": MARKDOWN_CONTENT_TYPE,
          vary: NEGOTIATION_VARY,
        },
      });
    }

    if (!isKnownPath(path)) {
      return new Response(notFoundMarkdown(path), {
        status: 404,
        headers: {
          "content-type": MARKDOWN_CONTENT_TYPE,
          vary: NEGOTIATION_VARY,
        },
      });
    }
  }

  // HTML variant of a content page: the response body varies by Accept, so make
  // caches key the Markdown and HTML representations apart.
  if (isContentRoute) {
    setResponseHeader(event, "Vary", NEGOTIATION_VARY);
  }
});
