import { CopyButton } from "@/components/st/copy-button";
import { cn } from "@/lib/utils";

/** Monospace block with a copy button. `code` is rendered as text. */
export function CodeBlock({ code, label = "Copy code", className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn("group relative rounded-lg border bg-card", className)}>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-[0.8125rem] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} label={label} size="icon-sm" />
      </div>
    </div>
  );
}
