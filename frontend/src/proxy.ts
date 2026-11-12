/**
 * Route protection (Next.js 16 "proxy", formerly middleware).
 *
 * This is only a cheap cookie-PRESENCE check so signed-out visitors do not see a flash of
 * the app shell. It is not the security boundary: the API validates the session on every
 * request, and the client confirms it through GET /auth/me (see src/lib/auth.tsx).
 *
 * The matcher deliberately excludes /api so request bodies of uploads are never buffered
 * by the proxy layer (Next.js buffers bodies, up to 10 MB, for routes a proxy runs on).
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "st_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/sign-in";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
