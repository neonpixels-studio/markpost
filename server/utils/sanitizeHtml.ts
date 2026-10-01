const LINK_URL_SCHEMES = ["http:", "https:", "mailto:"];
const IMAGE_URL_SCHEMES = ["http:", "https:"];
// Browsers ignore whitespace and control characters inside a URL scheme
// ("java\tscript:"), so they are stripped before the scheme check.
const URL_IGNORED_CHARS_PATTERN = /[\u0000- \u007f-\u009f]/g;
const URL_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*:)/i;

const GLOBAL_ALLOWED_ATTRIBUTES: string[] = [];
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
  const scheme = URL_SCHEME_PATTERN.exec(normalized)?.[1];
  // No scheme means a relative, fragment, or protocol-relative URL.
  if (!scheme) {
    return true;
  }
  return allowedSchemes.includes(scheme.toLowerCase());
}

export function isSafeLinkUrl(value: string | null | undefined): boolean {
  return isUrlSchemeAllowed(value, LINK_URL_SCHEMES);
}

export function isSafeImageUrl(value: string | null | undefined): boolean {
  return isUrlSchemeAllowed(value, IMAGE_URL_SCHEMES);
}

function isAttributeAllowed(element: Element, attributeName: string): boolean {
  const name = attributeName.toLowerCase();
  const allowedNames = [
    ...GLOBAL_ALLOWED_ATTRIBUTES,
    ...(ALLOWED_ATTRIBUTES_BY_TAG[element.nodeName] ?? []),
  ];
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
  const attributeNames = Array.from(element.attributes).map(
    (attribute) => attribute.name,
  );
  for (const attributeName of attributeNames) {
    if (!isAttributeAllowed(element, attributeName)) {
      element.removeAttribute(attributeName);
    }
  }
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
  if (DROPPED_WITH_CONTENT_TAGS.has(element.nodeName)) {
    element.parentNode?.removeChild(element);
    return;
  }
  if (!ALLOWED_TAGS.has(element.nodeName)) {
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
}
