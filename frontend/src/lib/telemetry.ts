/**
 * Page addresses are reduced before they are reported to the hosted deployment's page-view and
 * performance measurement: record identifiers in the path are replaced by a placeholder, and the
 * query string and fragment (which can carry a `next=` destination or a search term) are dropped.
 * What is reported is which kind of page was visited, never which record.
 */
const IDENTIFIER = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+)$/i;

export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const path = parsed.pathname
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return "[id]";
      }
      return IDENTIFIER.test(decoded) ? "[id]" : segment;
    })
    .join("/");
  return `${parsed.origin}${path}`;
}
