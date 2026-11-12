"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface SignedImageProps {
  /** Relative signed URL from the API (`preview_url`, `visual_url`, ...). Expires after 5 minutes. */
  src: string | null | undefined;
  /** Required. Describe the image ("Preview of IMG_0412.jpg"). */
  alt: string;
  /**
   * Called when the image fails to load, which normally means the signed URL expired.
   * Pass the parent query's `refetch`; when it delivers a new `src` the image retries.
   */
  onExpired?: () => void;
  /** Intrinsic size, when known, to reserve space and avoid layout shift. */
  width?: number;
  height?: number;
  /** Classes for the wrapper (set size / aspect ratio here). */
  className?: string;
  /** Classes for the `<img>` (e.g. `object-cover`, `object-contain`). */
  imgClassName?: string;
  loading?: "lazy" | "eager";
}

type LoadState = { src: string | null; status: "loading" | "loaded" | "failed" };

/**
 * `<img>` for short-lived signed URLs. Shows a skeleton while loading; on failure asks the
 * parent to refetch (once per URL) and shows a neutral placeholder until a fresh URL arrives.
 * A plain <img> is used on purpose: the files are private, already sized by the API, and
 * must not pass through an image optimiser or cache.
 */
export function SignedImage({
  src,
  alt,
  onExpired,
  width,
  height,
  className,
  imgClassName,
  loading = "lazy",
}: SignedImageProps) {
  const [state, setState] = useState<LoadState>({ src: null, status: "loading" });
  // Derive per-URL status during render: a new `src` resets to loading.
  const status = state.src === src ? state.status : "loading";

  return (
    <span className={cn("relative block overflow-hidden rounded-md bg-muted", className)}>
      {src && status !== "failed" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          draggable={false}
          onLoad={() => setState({ src, status: "loaded" })}
          onError={() => {
            setState({ src, status: "failed" });
            onExpired?.();
          }}
          className={cn(
            "block size-full transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : null}
      {src && status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {!src || status === "failed" ? (
        <span
          role="img"
          aria-label={`${alt} (not available)`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground"
        >
          <ImageOff aria-hidden="true" className="size-5" />
          <span className="text-[0.6875rem]">{src ? "Reloading" : "No preview"}</span>
        </span>
      ) : null}
    </span>
  );
}
