/**
 * Multipart upload with progress. `fetch` cannot report upload progress, so this uses
 * XMLHttpRequest. CSRF and error normalisation match the fetch client.
 */
import { ensureCsrfToken, notifyIfUnauthorized } from "./client";
import { ApiError, toApiError } from "./errors";
import type { UploadResponse } from "./types";

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  fraction: number;
}

export interface UploadOptions {
  /** Same-origin API path, e.g. `/api/v1/evidence` or `/api/v1/sensors/{id}/references`. */
  url: string;
  files: File[];
  /** Extra form fields. Objects are JSON-encoded; null/undefined/empty values are skipped. */
  fields?: Record<string, string | number | boolean | object | null | undefined>;
  /** Form field name for the files (repeated). Defaults to `files`. */
  fileField?: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export async function uploadFiles<T = UploadResponse>(options: UploadOptions): Promise<T> {
  const { url, files, fields, fileField = "files", onProgress, signal } = options;

  const form = new FormData();
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  for (const file of files) form.append(fileField, file, file.name);

  const csrf = await ensureCsrfToken();

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.setRequestHeader("accept", "application/json");
    if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total, fraction: e.total ? e.loaded / e.total : 0 });
      }
    };
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      cleanup();
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const error = toApiError(xhr.status, body);
      notifyIfUnauthorized(error, new URL(url, window.location.origin).pathname);
      reject(error);
    };
    xhr.onerror = () => {
      cleanup();
      reject(toApiError(0, null));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.send(form);
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Split an array into consecutive chunks of at most `size` items. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export { ApiError };
