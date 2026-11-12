/**
 * Typed API client (openapi-fetch) for same-origin `/api/v1`.
 *
 * - Injects `X-CSRF-Token` on every unsafe request. The token lives in memory only.
 * - Converts every non-2xx response and network failure into a thrown `ApiError`.
 * - Reports 401s to a single handler (registered by AuthProvider) for redirecting.
 *
 * Usage:   const device = await unwrap(api.GET("/api/v1/devices/{device_id}", { params: { path: { device_id } } }));
 */
import createClient, { type Middleware } from "openapi-fetch";

import { ApiError, toApiError } from "./errors";
import type { paths } from "./schema";

export const API_PREFIX = "/api/v1";

/* ------------------------------------------------------------ CSRF store */

let csrfToken: string | null = null;
let csrfInflight: Promise<string | null> | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * Returns the CSRF token, fetching it from /auth/me if it is not in memory yet (for
 * example when a mutation fires before the session query has resolved after a reload).
 */
export async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  csrfInflight ??= fetch(`${API_PREFIX}/auth/me`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { csrf_token?: string | null };
      csrfToken = body.csrf_token ?? null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      csrfInflight = null;
    });
  return csrfInflight;
}

/* ---------------------------------------------------------- 401 handling */

type UnauthorizedHandler = (error: ApiError) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered once by AuthProvider. Called for any 401 outside the /auth/* endpoints. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/** Shared by the fetch client and the XHR upload helper. */
export function notifyIfUnauthorized(error: ApiError, pathname: string): void {
  if (error.status === 401 && !pathname.startsWith(`${API_PREFIX}/auth/`)) onUnauthorized?.(error);
}

/* ------------------------------------------------------------ middleware */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT = [`${API_PREFIX}/auth/login`, `${API_PREFIX}/auth/register`];

const middleware: Middleware = {
  async onRequest({ request }) {
    if (UNSAFE.has(request.method)) {
      const { pathname } = new URL(request.url);
      if (!CSRF_EXEMPT.includes(pathname)) {
        const token = await ensureCsrfToken();
        if (token) request.headers.set("X-CSRF-Token", token);
      }
    }
    return request;
  },
  async onResponse({ response, request }) {
    if (response.ok) return response;
    let body: unknown = null;
    try {
      body = await response.clone().json();
    } catch {
      /* not JSON */
    }
    const error = toApiError(response.status, body);
    notifyIfUnauthorized(error, new URL(request.url).pathname);
    throw error;
  },
  onError({ error }) {
    if (error instanceof ApiError) return error;
    if (error instanceof DOMException && error.name === "AbortError") return error;
    return toApiError(0, null);
  },
};

export const api = createClient<paths>({
  baseUrl: "",
  credentials: "same-origin",
  headers: { accept: "application/json" },
});
api.use(middleware);

/**
 * Await an openapi-fetch call and return its data. Errors have already been thrown as
 * `ApiError` by the middleware, so this only strips the `{ data, error }` envelope.
 * Pass a type argument to narrow free-form schema objects to the shapes in `types.ts`:
 *   unwrap<AnalysisDetail>(api.GET("/api/v1/analyses/{analysis_id}", ...))
 */
export async function unwrap<T = never, D = unknown>(
  call: Promise<{ data?: D; error?: unknown; response: Response }>,
): Promise<[T] extends [never] ? D : T> {
  const { data, error, response } = await call;
  if (error !== undefined && !response.ok) throw toApiError(response.status, error);
  return data as [T] extends [never] ? D : T;
}
