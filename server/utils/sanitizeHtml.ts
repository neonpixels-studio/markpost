const LINK_URL_SCHEMES = ["http:", "https:", "mailto:"];
const IMAGE_URL_SCHEMES = ["http:", "https:"];
// Browsers ignore whitespace and control characters inside a URL scheme
// ("java\tscript:"), so they are stripped before the scheme check.
const URL_IGNORED_CHARS_PATTERN = /[\u0000- \u007f-\u009f]/g;
const ATTRIBUTE_BREAKING_CHARS_PATTERN = /[\r\n<>]+/g;
const CARRIAGE_RETURN_PATTERN = /\r\n?/g;
const BLANK_LINE_PATTERN = /\n[ \t]*(?=\n)/g;
const TEXT_NODE_TYPE = 3;
const PROCESSING_INSTRUCTION_NODE_TYPE = 7;
const COMMENT_NODE_TYPE = 8;
const URL_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*:)/i;
// Markdown renderers decode entities and backslash escapes in link
// destinations, so "javascript&#58;" or "javascript\\:" would become a real
// scheme after storage. Any entity-shaped sequence or backslash before the first path/query
// delimiter is treated as an obfuscated scheme and rejected.
const URL_SCHEME_SEGMENT_PATTERN = /^[^/?]*/;
const URL_OBFUSCATION_PATTERN = /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);|\\/i;

const ALLOWED_ATTRIBUTES_BY_TAG: Record<string, string[]> = {
  A: ["href", "title"],
  IMG: ["src", "alt", "title", "width", "height"],
  TD: ["colspan", "rowspan", "align"],
  TH: ["colspan", "rowspan", "align"],
  COL: ["span"],
  COLGROUP: ["span"],
  OL: ["start"],
};
const URL_ATTRIBUTE_SCHEMES: Record<string, string[]> = {
  href: LINK_URL_SCHEMES,
  src: IMAGE_URL_SCHEMES,
};

const ALLOWED_TAGS = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TD",
  "TH",
  "CAPTION",
  "COLGROUP",
  "COL",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "P",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "EM",
  "STRONG",
  "B",
  "I",
  "U",
  "S",
  "SUB",
  "SUP",
  "SPAN",
  "DIV",
  "A",
  "IMG",
]);
// Tags whose children are executable or opaque, so they are removed with their
// content. Any other unlisted tag is unwrapped (its text children are kept).
const DROPPED_WITH_CONTENT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "FRAME",
  "FRAMESET",
  "OBJECT",
  "EMBED",
  "APPLET",
  "SVG",
  "MATH",
  "TEMPLATE",
  "NOSCRIPT",
  "TEXTAREA",
  "SELECT",
  "LINK",
  "META",
  "BASE",
  "TITLE",
  "HEAD",
]);

function isUrlSchemeAllowed(
  value: string | null | undefined,
  allowedSchemes: string[],
): boolean {
  const normalized = (value ?? "").replace(URL_IGNORED_CHARS_PATTERN, "");
  const schemeSegment = URL_SCHEME_SEGMENT_PATTERN.exec(normalized)?.[0] ?? "";
  if (URL_OBFUSCATION_PATTERN.test(schemeSegment)) {
    return false;
  }
  const scheme = URL_SCHEME_PATTERN.exec(normalized)?.[1];
  // No scheme means a relative, fragment, or protocol-relative URL.
  if (!scheme) {
    return true;
  }
  return allowedSchemes.includes(scheme.toLowerCase());
}

// Turndown escapes <>() in link destinations and quotes in titles but not
// backslashes, so a backslash could close the link early and start an autolink.
export function hasBackslash(value: string | null | undefined): boolean {
  return (value ?? "").includes("\\");
}

export function isSafeLinkUrl(value: string | null | undefined): boolean {
  return isUrlSchemeAllowed(value, LINK_URL_SCHEMES);
}

export function isSafeImageUrl(value: string | null | undefined): boolean {
  return isUrlSchemeAllowed(value, IMAGE_URL_SCHEMES);
}

function isAttributeAllowed(element: Element, attributeName: string): boolean {
  const name = attributeName.toLowerCase();
  const allowedNames =
    ALLOWED_ATTRIBUTES_BY_TAG[element.nodeName.toUpperCase()] ?? [];
  if (!allowedNames.includes(name)) {
    return false;
  }
  const allowedSchemes = URL_ATTRIBUTE_SCHEMES[name];
  if (!allowedSchemes) {
    return true;
  }
  return isUrlSchemeAllowed(
    element.getAttribute(attributeName),
    allowedSchemes,
  );
}

function stripDisallowedAttributes(element: Element): void {
  Array.from(element.attributes)
    .map((attribute) => attribute.name)
    .filter((attributeName) => !isAttributeAllowed(element, attributeName))
    .forEach((attributeName) => element.removeAttribute(attributeName));
}

// A raw HTML block ends at the first blank line and the remainder is parsed as
// Markdown again. Kept attribute values and text must never serialize with a
// blank line (or a literal "<") or they could smuggle markup out of the block.
function normalizeAttributeValues(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    const isUrl = attribute.name.toLowerCase() in URL_ATTRIBUTE_SCHEMES;
    const normalized = isUrl
      ? attribute.value.replace(URL_IGNORED_CHARS_PATTERN, "")
      : attribute.value.replace(ATTRIBUTE_BREAKING_CHARS_PATTERN, " ");
    element.setAttribute(attribute.name, normalized);
  }
}

// Turndown strips comments outside <pre> but not inside it, and a comment body
// is serialized verbatim, so blank lines in it would end the HTML block.
function removeNonContentNodes(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (
      child.nodeType === COMMENT_NODE_TYPE ||
      child.nodeType === PROCESSING_INSTRUCTION_NODE_TYPE
    ) {
      node.removeChild(child);
      continue;
    }
    removeNonContentNodes(child);
  }
}

function breakBlankLines(node: Node): void {
  if (node.nodeType === TEXT_NODE_TYPE) {
    node.textContent = (node.textContent ?? "")
      .replace(CARRIAGE_RETURN_PATTERN, "\n")
      .replace(BLANK_LINE_PATTERN, "\n\u00a0");
    return;
  }
  Array.from(node.childNodes).forEach(breakBlankLines);
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeElement(element: Element): void {
  // Foreign-namespace elements (svg, math) keep a lowercase nodeName.
  const tagName = element.nodeName.toUpperCase();
  if (DROPPED_WITH_CONTENT_TAGS.has(tagName)) {
    element.parentNode?.removeChild(element);
    return;
  }
  if (!ALLOWED_TAGS.has(tagName)) {
    unwrapElement(element);
    return;
  }
  stripDisallowedAttributes(element);
}

// Allowlist-sanitizes an element subtree in place. The root element itself is
// only attribute-stripped; descendants are removed, unwrapped, or stripped.
export function sanitizeElementTree(root: Element): void {
  stripDisallowedAttributes(root);
  // Static snapshot, so unwrapping/removing doesn't disturb iteration.
  const descendants = Array.from(root.querySelectorAll("*"));
  for (const descendant of descendants) {
    sanitizeElement(descendant);
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    normalizeAttributeValues(element);
  }
  removeNonContentNodes(root);
  breakBlankLines(root);
}
