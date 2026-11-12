/**
 * Validation of the post-sign-in destination (`?next=`).
 *
 * Only same-site absolute paths are accepted, which rules out open redirects such as
 * `//evil.example` or `https://...`. A prefix test alone is not enough: URL parsers drop tabs and
 * newlines, so `/\t/evil.example` is read as `//evil.example`, and they resolve dot segments, so
 * `/.//evil.example` becomes the path `//evil.example`. The value is therefore also parsed the way
 * a browser parses it and must stay on the placeholder origin.
 */
const PLACEHOLDER_ORIGIN = "http://sensortrace.invalid";

export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname.startsWith("//")) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
