import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

/** Show an API failure as a toast, using the API's own user-facing message. */
export function toastError(err: unknown, title = "That did not work"): void {
  toast.error(title, { description: errorMessage(err) });
}

export function toastSuccess(title: string, description?: string): void {
  toast.success(title, description ? { description } : undefined);
}
