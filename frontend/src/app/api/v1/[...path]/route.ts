/**
 * Same-origin API proxy.
 *
 * The browser only ever talks to `/api/v1/...` on the frontend origin, so the HttpOnly
 * session cookie works without CORS. This handler streams each request to the backend
 * named by `API_INTERNAL_URL`, which is read at RUNTIME (per request), so one built
 * image can be pointed at any backend. Request bodies (including multipart uploads) and
 * response bodies (including binary downloads) are streamed, never buffered.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_API_URL = "http://127.0.0.1:8100";

/** Headers that describe one hop of the connection and must not be forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "expect",
]);

function apiBase(): string {
  return (process.env.API_INTERNAL_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: null } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${apiBase()}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Ask for an unencoded body so it can be passed through byte for byte.
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Required by Node.js when the request body is a stream.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: req.signal,
    } as RequestInit);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error(`[api-proxy] ${req.method} ${target} failed:`, err);
    return errorResponse(
      502,
      "upstream_unavailable",
      "The SensorTrace API is not reachable. Check that the backend is running.",
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "set-cookie" || k === "content-encoding") return;
    responseHeaders.set(key, value);
  });
  // Set-Cookie must be forwarded one header per cookie, never comma-joined.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "no-store");

  const noBody = upstream.status === 204 || upstream.status === 304 || req.method === "HEAD";
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
