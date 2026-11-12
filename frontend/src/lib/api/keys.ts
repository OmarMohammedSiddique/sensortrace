/**
 * Query-key factories. Always build keys through `qk` so invalidation stays consistent.
 * Convention: [resource, "list" | "detail" | sub-resource, params-or-id].
 * Invalidate a whole resource with `queryClient.invalidateQueries({ queryKey: qk.devices.all })`.
 */
type Params = object | undefined;

function resource<R extends string>(name: R) {
  return {
    all: [name] as const,
    lists: () => [name, "list"] as const,
    list: (params?: Params) => [name, "list", params ?? {}] as const,
    details: () => [name, "detail"] as const,
    detail: (id: string) => [name, "detail", id] as const,
  };
}

export const qk = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  dashboard: ["dashboard"] as const,
  policies: ["policies"] as const,
  usage: ["account", "usage"] as const,
  audit: (params?: Params) => ["account", "audit", params ?? {}] as const,
  exports: ["account", "exports"] as const,
  sessions: ["auth", "sessions"] as const,
  tokens: ["auth", "tokens"] as const,
  adminConfig: ["admin", "config"] as const,
  adminStats: ["admin", "stats"] as const,

  jobs: resource("jobs"),
  devices: resource("devices"),
  sensors: {
    ...resource("sensors"),
    references: (sensorId: string, params?: Params) =>
      ["sensors", "detail", sensorId, "references", params ?? {}] as const,
    fingerprints: (sensorId: string) => ["sensors", "detail", sensorId, "fingerprints"] as const,
  },
  fingerprints: resource("fingerprints"),
  investigations: {
    ...resource("investigations"),
    notes: (id: string) => ["investigations", "detail", id, "notes"] as const,
    history: (id: string, params?: Params) =>
      ["investigations", "detail", id, "history", params ?? {}] as const,
  },
  evidence: resource("evidence"),
  analyses: resource("analyses"),
  reports: resource("reports"),
};
