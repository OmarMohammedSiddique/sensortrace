/**
 * Predicts how the engine will align a questioned image with a fingerprint, from pixel
 * dimensions alone. Mirrors the engine's rule (matching.py): equal = native, transposed =
 * rotated, fits inside (either way round) = exhaustive crop search, otherwise no test.
 * This is guidance before a run; the measured geometry on the result page is authoritative.
 */
export type PredictedGeometry = "native" | "rotated" | "cropped" | "unsupported";

export function predictGeometry(imageW: number, imageH: number, fpW: number, fpH: number): PredictedGeometry {
  if (imageW === fpW && imageH === fpH) return "native";
  if (imageW === fpH && imageH === fpW) return "rotated";
  const fits = imageH <= fpH && imageW <= fpW;
  const fitsTransposed = imageW <= fpH && imageH <= fpW;
  return fits || fitsTransposed ? "cropped" : "unsupported";
}

/** Same normalisation the API uses to decide that two devices are the same make and model. */
export function modelKey(make: string | null | undefined, model: string | null | undefined): string {
  return `${make ?? ""} ${model ?? ""}`.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
