/** Field-level validation problem as returned in `error.details` for `validation_error`. */
export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * Every failed API call is normalised into this class. `message` is written by the API for
 * end users and is safe to display as-is.
 */
export class ApiError extends Error {
  readonly name = "ApiError";
  constructor(
    /** HTTP status; 0 when the request never reached the server. */
    readonly status: number,
    /** Stable machine code, e.g. `not_authenticated`, `validation_error`, `rate_limited`. */
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Per-field messages for `validation_error` responses (empty otherwise). */
  get fieldIssues(): FieldIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is FieldIssue =>
        typeof d === "object" && d !== null && "field" in d && "message" in d,
    );
  }
}

const FALLBACK: Record<number, string> = {
  0: "Could not reach the server. Check your connection and try again.",
  401: "You need to sign in to continue.",
  403: "You do not have permission to do that.",
  404: "That item could not be found.",
  413: "The upload is too large.",
  429: "Too many requests. Please wait a moment and try again.",
  502: "The SensorTrace API is not reachable.",
};

/** Build an ApiError from a status code and a parsed (or unparseable) response body. */
export function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const e = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
    if (e && typeof e.message === "string") {
      return new ApiError(status, typeof e.code === "string" ? e.code : "error", e.message, e.details ?? null);
    }
  }
  return new ApiError(
    status,
    status === 0 ? "network_error" : `http_${status}`,
    FALLBACK[status] ?? `The request failed (HTTP ${status}).`,
  );
}

/** Read any thrown value as a user-presentable message. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
