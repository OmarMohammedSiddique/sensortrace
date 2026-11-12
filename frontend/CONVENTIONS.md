# Frontend conventions

Everything a page author needs. The shared brief's hard rules still apply (API-only data, verdict
wording, reasons + caveats + policy status next to every verdict, demo badges, visualisation notices,
no admissibility claims, no `dangerouslySetInnerHTML`, no third-party requests).

## 1. Stack facts that will bite you

- **Next.js 16.4, React 19.3, Tailwind v4, shadcn "radix-nova" style, lucide-react 1.x, zod 4,
  TanStack Query 5.** Read `node_modules/next/dist/docs/` if an API looks unfamiliar.
- Middleware is called **proxy** in Next 16: `src/proxy.ts`. It only checks that the `st_session`
  cookie is present for `/app/**`.
- `cacheComponents` is **off** (the scaffold default was on). All app data is fetched on the client.
- `params` / `searchParams` are Promises in server pages. In client pages use `useParams()` /
  `useSearchParams()`; **wrap any component that calls `useSearchParams()` in `<Suspense>`** or the build fails.
- shadcn components import `cn` from the `cn` package; app code may use `@/lib/utils` (same function).
- The registry no longer ships `form`; `src/components/ui/form.tsx` is the classic react-hook-form
  wrapper (`Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage`).
  `field.tsx` (the new primitive) is also installed.
- Button sizes are compact: `default` h-8, `sm` h-7, `xs` h-6, `lg` h-9, `icon`, `icon-sm`, `icon-xs`.
  The `destructive` variant is a tinted (not solid) button.
- ESLint enforces the React Compiler rules: no `setState` directly in an effect body, no reading
  refs during render. Derive state during render, or use `useSyncExternalStore`.
- **Server/client boundary:** a server component cannot pass a function or a lucide icon to a
  component that is marked `"use client"`. `PageHeader`, `EmptyState`, `ErrorState`, `Stat`,
  `MetricCard`, `VerdictBadge`, `DemoBadge`, `QualityFlags`, `PolicyNotice`, `Hash` are *not* client
  components, so they work from both. Real pages will almost always be `"use client"` anyway.
- `globals.css` has `@import "tailwindcss" source("..")`: only `src/` is scanned for classes. Do not
  remove it (without it the dev server reloads in a loop).
- Add a shadcn component with `npx shadcn@latest add <name>`; never hand-copy from the web.

## 2. Folder structure

```
src/
  app/
    (marketing)/            public pages + MarketingShell layout
    (auth)/                 /sign-in, /register
    app/                    authenticated area; layout.tsx mounts AppShell
      page.tsx              dashboard (done)
      cameras/ sensors/ investigations/ compare/ analyses/ reports/ jobs/ settings/ onboarding/
                            placeholder pages: REPLACE the page.tsx, keep the route path
    api/v1/[...path]/route.ts   runtime API proxy (do not add other /api routes)
  components/
    ui/                     shadcn primitives (edit sparingly)
    st/                     SensorTrace shared components (section 5)
    shell/                  app shell, marketing shell, nav config, theme toggle, jobs indicator
    marketing/              public-page building blocks
    dashboard/              dashboard page
    <feature>/              put your feature components here (cameras/, investigations/, ...)
  lib/
    api/                    client, errors, hooks, keys, types, upload, schema.d.ts (generated)
    auth.tsx                AuthProvider, useAuth, useUser, safeNextPath
    domain.ts               labels and helpers for API enums (verdicts, pipeline, jobs, audit text)
    format.ts               formatBytes, formatNumber, formatPce, formatSmall, formatDateTime, ...
    toast.ts                toastError, toastSuccess
  proxy.ts                  cookie-presence redirect for /app/**
```

Page files stay thin: `export const metadata = { title: "Cameras" }` plus one feature component.
If the page file must be a client component, drop `metadata` (the layout title template still applies).

Dashboard quick actions link to **`/app/cameras?new=1`** and **`/app/investigations?new=1`**: open
your create dialog when `new=1` is present. Other links that already exist and must resolve:
`/app/cameras/{deviceId}`, `/app/sensors/{sensorId}`, `/app/investigations/{id}`,
`/app/analyses/{id}`, `/app/compare`, `/app/reports`, `/app/jobs`, `/app/settings`, `/app/onboarding`.

## 3. Calling the API

```ts
import { api, unwrap } from "@/lib/api/client";
import type { Device } from "@/lib/api/types";

const device = await unwrap<Device>(
  api.GET("/api/v1/devices/{device_id}", { params: { path: { device_id } } }),
);
```

- `api` is an `openapi-fetch` client typed from `schema.d.ts`. Paths include the `/api/v1` prefix.
- `unwrap()` returns the data or throws. **Every failure is an `ApiError`** (`@/lib/api/errors`) with
  `status`, `code`, `message` (written for users: show it as is), `details`, plus `isNotFound`,
  `isRateLimited`, `isNetwork`, and `fieldIssues` (`[{field, message}]` for `validation_error`).
  `errorMessage(err)` turns anything thrown into a string.
- CSRF is automatic: `X-CSRF-Token` is added to POST/PUT/PATCH/DELETE. Never read or store the token.
- 401 handling is automatic: the session is cleared and `/app` pages redirect to `/sign-in?next=...`.
- 429: just show `error.message` (`toastError(err)`).
- **Types:** import from `@/lib/api/types`, not from `schema.d.ts`. The OpenAPI document types several
  fields as free-form objects; `types.ts` gives them real shapes (`QualityReport`, `Measurement`,
  `Decision`, `NuaInfo`, `CandidateSnapshot`, `PolicySnapshot`, `AnalysisSummary`, `Dashboard`,
  `Meta`). Pass the type to `unwrap<T>()` to apply them. Fields in those shapes are optional: read
  defensively.
- **Request bodies:** use the `...In` / `...Patch` types from `types.ts` (`DeviceIn`, `SensorIn`,
  `InvestigationIn`, `AnalysisIn`, `EvidencePatch`, ...). They make server-defaulted fields optional.
- Lists are `Page<T>` = `{ items, total, limit, offset }`.
- After the backend changes: `npm run gen:api`, then fix `types.ts` if a hand-written shape moved.

### Hooks (`@/lib/api/hooks`)

Queries: `useMe`, `useMeta`, `useDashboard`, `usePolicies`, `useUsage`, `useAudit(params)`,
`useJobs(params, {poll})`, `useJob(id)`, `useDevices(params)`, `useDevice(id)`, `useSensors({ready,...})`,
`useSensor(id)`, `useReferences(sensorId, params)`, `useFingerprints(sensorId)`, `useFingerprint(id)`,
`useInvestigations({status,q,...})`, `useInvestigation(id)`, `useInvestigationNotes(id)`,
`useInvestigationHistory(id, params)`, `useEvidenceList(params)`, `useEvidence(id)`,
`useAnalyses(params)`, `useAnalysis(id)`, `useReports(params)`, `useReport(id)`.

Mutations (all return TanStack mutations whose error type is `ApiError`, and invalidate the right
queries): `useCreateDevice`, `useUpdateDevice(id)`, `useDeleteDevice`, `useCreateSensor(deviceId)`,
`useUpdateSensor(id)`, `useDeleteSensor`, `useDeleteReference`, `useStartFingerprint(sensorId)`,
`useActivateFingerprint`, `useDeleteFingerprint`, `useCreateInvestigation`,
`useUpdateInvestigation(id)`, `useDeleteInvestigation`, `useAddNote(invId)`, `useDeleteNote(invId)`,
`useUpdateEvidence` (`{id, ...patch}`), `useDeleteEvidence`, `useStartAnalyses`, `useUpdateAnalysis`
(`{id, ...patch}`), `useDeleteAnalysis`, `useCreateAnalysisReport`, `useCreateInvestigationReport`,
`useDeleteReport`, `useCancelJob`, `useUpdateProfile`, `useCreateDemo`, `useDeleteDemo`.

Not wrapped yet (add them next to the others when you build Settings): sessions, API tokens,
password change, account/investigation export, exports list, account deletion, admin config/stats.
Keys for them already exist in `keys.ts`.

### Adding a hook

1. Key: use `qk` from `@/lib/api/keys` (`qk.devices.list(params)`, `qk.devices.detail(id)`,
   `qk.devices.all` to invalidate the resource). Add a factory there if needed; never inline keys.
2. Query:
   ```ts
   export function useThing(id: string | undefined) {
     return useQuery({
       queryKey: qk.things.detail(id ?? ""),
       queryFn: () => unwrap<Thing>(api.GET("/api/v1/things/{thing_id}", { params: { path: { thing_id: id! } } })),
       enabled: Boolean(id),
     });
   }
   ```
   List hooks use `placeholderData: keepPreviousData`.
3. Mutation: `useApiMutation(fn, { invalidate: [qk.things.all, qk.dashboard] })`.
4. **Signed file URLs** (`preview_url`, `download_url`, `visual_url`, `spectrum_url`,
   `residual_visual_url`, `evidence_preview_url`) expire after 5 minutes. Any query whose result
   carries one must spread `staleTime: FILE_URL_STALE_TIME, refetchInterval: FILE_URL_REFETCH`
   (the existing evidence/reference/fingerprint/analysis/report hooks do).

### Auth (`@/lib/auth`)

`useAuth()` -> `{ status: "loading"|"authenticated"|"unauthenticated"|"error", user, csrfToken,
error, signIn({email,password}), register({email,password,display_name?}), signOut(redirectTo?),
refresh() }`. Inside `/app` a session is guaranteed, so use `useUser()` (non-null `User`).
`safeNextPath(next)` validates redirect targets. After changing the profile, invalidate `qk.me`
(`useUpdateProfile` does).

## 4. Patterns

### Loading, empty, error

```tsx
const pagination = usePagination(25);
const q = useDevices(pagination.params);

<DataTable
  caption="Cameras"
  columns={columns}
  rows={q.data?.items}
  rowKey={(d) => d.id}
  loading={q.isPending}
  fetching={q.isFetching}
  error={q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
  empty={<EmptyState icon={Camera} title="No cameras yet" description="..." action={<Button>Register a camera</Button>} />}
/>
<DataTablePagination pagination={pagination} total={q.data?.total} label="cameras" />
```

- First load (`isPending`): skeletons shaped like the content (`Skeleton`, or `loading` on
  `DataTable` / `Stat` / `MetricCard`). Never a spinner on a blank page.
- Empty: `EmptyState` with ONE primary action.
- Error: `ErrorState` with `onRetry={() => void query.refetch()}`. Use `variant="inline"` inside
  cards and forms.
- Mutations: disable the submit button while `isPending`; on error `toastError(err)` or show
  `err.message` inline with `role="alert"`; map `err.fieldIssues` onto form fields
  (`applyApiError` in `components/marketing/auth-forms.tsx` shows how).
- Detail page not found: `query.error.isNotFound` -> an `EmptyState` with a link back to the list.
- Forms: react-hook-form + zod + `components/ui/form`. Every control needs a label.

### Background jobs

Endpoints that start work return a `job` (or `jobs`). Keep the id and render `JobProgress`:

```tsx
const start = useStartFingerprint(sensorId);
const [jobId, setJobId] = useState<string | null>(null);

<Button disabled={start.isPending} onClick={() => start.mutate(undefined, {
  onSuccess: ({ job }) => setJobId(job.id), onError: (e) => toastError(e) })}>Estimate fingerprint</Button>

{jobId ? <JobProgress jobId={jobId} onDone={(job) => { if (job.status === "succeeded") ... }} /> : null}
```

- `JobProgress` polls every 1.5 s while `queued`/`running`, shows stage, progress, message, a cancel
  button and the terminal state (with `error` on failure), and calls `onDone` once.
- When a job finishes, the affected queries are invalidated for you: by `JobProgress` (default
  `invalidate`), and globally by the top-bar `JobsIndicator`, which watches the active-jobs list. You
  normally do not need your own polling. `invalidateAfterJob(queryClient, job)` exists if you do.
- To find a running job for something already on screen after a reload, use the object's own field
  (`analysis.job_id`) or `useJobs({ active: true })` and match `target_type` + `target_id`
  (`fingerprint` jobs target the fingerprint id, `analysis` jobs the analysis id, `export` the export id).
- Helpers: `isJobActive(job)`, `isJobTerminal(job)`, `jobKindLabel(kind)`, `jobStageLabel(job)`.

### Verdicts (release-blocking)

Wherever a verdict appears, show next to it: `<VerdictBadge>`, `decision.reasons`,
`decision.caveats`, and `<PolicyNotice policy={decision.policy ?? analysis.policy} />`.
Use `VERDICT_LABELS` for text; never invent wording, never show a percentage, probability or
"confidence". When `needsSameModelControl(decision.nua)` is true, explain that a high statistic
cannot be attributed to the individual sensor and suggest enrolling a second device of the same
make and model as a control. PCE values: `<Pce>` or `formatPce`. Images of noise/fingerprints:
caption with the API's `visualisation_notice`. `is_demo` objects: `<DemoBadge when={x.is_demo} />`.

### Breadcrumbs

The top bar shows a static trail from the URL. On detail pages call
`useBreadcrumbLabel(device?.name)` (`@/components/shell/breadcrumb-context`) to replace the last
crumb with the real name. `PageHeader` also accepts a `breadcrumb` prop if you want the trail in
the page; do not use both.

## 5. Shared components (`@/components/st/*`)

| Component (file) | Props | Usage |
|---|---|---|
| `VerdictBadge` (verdict-badge) | `verdict` (API code or null), `size?: "sm"\|"md"\|"lg"`, `short?`, `wrap?`, `className?` | `<VerdictBadge verdict={c.verdict} />`. Also exports `VERDICT_STYLES[verdict]` = `{icon, badge, text, swatch}` classes |
| `DemoBadge` (demo-badge) | `when?: boolean`, `className?` | `<DemoBadge when={device.is_demo} />` |
| `Hash` (hash) | `value`, `chars?=8`, `full?`, `label?="SHA-256"`, `copy?=true` | `<Hash value={e.sha256} />`, `<Hash value={fp.digest} label="fingerprint digest" full />` |
| `CopyButton` (copy-button) | `value`, `label?`, `children?`, `size?`, `variant?` | `<CopyButton value={token} label="Copy token" />` (client) |
| `FormattedDate` (formatted) | `value` (ISO), `mode?: "datetime"\|"date"\|"relative"` | `<FormattedDate value={x.created_at} mode="relative" />` (client) |
| `Bytes` (formatted) | `value` | `<Bytes value={e.size_bytes} />` |
| `Pce` (formatted) | `value` | `<Pce value={c.effective_pce} />` |
| `Stat` (stat) | `label`, `value`, `unit?`, `hint?`, `mono?`, `loading?` | inside a `<dl>`: `<Stat label="Valid pixels" value={formatNumber(n)} />` |
| `MetricCard` (stat) | `Stat` props + `icon?`, `href?` | inside a `<dl className="grid ...">`: `<MetricCard label="Cameras" value="3" icon={Camera} href="/app/cameras" />` |
| `PageHeader` (page-header) | `title`, `description?`, `actions?`, `breadcrumb?: {label, href?}[]`, `badges?`, `eyebrow?` | first element of every page; renders the only `<h1>` |
| `EmptyState` (states) | `icon?`, `title`, `description?`, `action?`, `secondaryAction?`, `variant?: "card"\|"plain"` | see 4 |
| `ErrorState` (states) | `error?`, `title?`, `onRetry?`, `retrying?`, `variant?: "card"\|"plain"\|"inline"` | see 4 |
| `LoadingRows` (states) | `rows?` | generic skeleton block |
| `JobProgress` (job-progress) | `jobId`, `title?`, `compact?`, `hideCancel?`, `onDone?(job)`, `invalidate?=true` | see 4 (client) |
| `JobProgressView` (job-progress) | `job`, `title?`, `compact?`, `onCancel?`, `cancelling?` | presentational row when you already hold a `Job` (jobs table, lists) |
| `JobStatusBadge` (job-progress) | `status` | `<JobStatusBadge status={job.status} />` |
| `UploadDropzone` (upload-dropzone) | `url`, `fields?`, `onBatch?(response)`, `onComplete?({accepted, rejected, failed})`, `title?`, `description?`, `maxFiles?`, `multiple?=true`, `disabled?`, `compact?` | `<UploadDropzone url={`/api/v1/sensors/${id}/references`} onComplete={() => qc.invalidateQueries({ queryKey: qk.sensors.all })} />`; evidence: `url="/api/v1/evidence" fields={{ investigation_id, category: "questioned", acquisition: {...} }}` (objects are JSON-encoded). Uploads start on selection, chunked by `/meta` limits, with per-file progress, results list, retry and cancel (client) |
| `ConfirmDialog` (confirm-dialog) | `open`, `onOpenChange`, `title`, `description`, `confirmLabel?="Delete"`, `cancelLabel?`, `destructive?=true`, `typedConfirmation?`, `onConfirm` (may return a promise), `children?` | `<ConfirmDialog open={open} onOpenChange={setOpen} title="Delete camera?" description="..." typedConfirmation={device.name} onConfirm={() => del.mutateAsync(device.id)} />`. Stays open and shows the message if the promise rejects (client) |
| `QualityFlags` (quality-flags) | `quality` (QualityReport or flags[]), `variant?: "list"\|"summary"`, `hideInfo?`, `emptyText?` | `<QualityFlags quality={evidence.quality} />`; table cell: `variant="summary"` |
| `DataTable` (data-table) | `columns: Column<T>[]` (`{id, header, cell(row), align?, className?, skeleton?}`), `rows`, `rowKey`, `caption`, `loading?`, `fetching?`, `empty?`, `error?`, `skeletonRows?`, `onRowClick?` | see 4 (client) |
| `usePagination(pageSize)` / `DataTablePagination` (data-table) | `pagination`, `total`, `label?` | see 4. Call `pagination.reset()` when filters change |
| `SignedImage` (signed-image) | `src`, `alt` (required), `onExpired?`, `width?`, `height?`, `className?` (wrapper: set size/aspect here), `imgClassName?`, `loading?` | `<SignedImage src={e.preview_url} alt={`Preview of ${e.filename}`} onExpired={() => void q.refetch()} className="aspect-[4/3] w-full" imgClassName="object-contain" />` (client) |
| `CorrelationSurface` (correlation-surface) | `surface` (`measurement.surface_window`), `size?=264`, `label?`, `hideCaption?` | `<CorrelationSurface surface={c.measurement.surface_window} label={c.snapshot.sensor_name} />`. `surfaceStats(surface)` returns `{centre, max, maxRow, maxCol, min, absMax}`. Colours are scaled per plot and are not comparable between plots (client) |
| `PolicyNotice` (policy-notice) | `policy`, `variant?: "full"\|"compact"` | `<PolicyNotice policy={analysis.policy} />` |
| `Logo`, `LogoMark` (logo) | `className?`, `markOnly?` | brand mark |

Helpers in `@/lib/domain`: `VERDICT_LABELS`, `VERDICT_SHORT_LABELS`, `isVerdict`, `PIPELINE_LABELS`,
`PIPELINE_DESCRIPTIONS`, `DEVICE_TYPE_LABELS`, `CATEGORY_LABELS`, `JOB_KIND_LABELS`,
`JOB_STATUS_LABELS`, `NUA_MITIGATION_LABELS`, `needsSameModelControl(nua)`, `auditText(entry)`,
`auditHref(entry)`, `jobHref(job)`.

Helpers in `@/lib/format`: `formatBytes`, `formatNumber(v, fractionDigits)`, `formatPce`,
`formatSmall` (NCC, p-values), `truncateMiddle`, `humanize`, `pluralize(n, "image")`,
`formatDateTime`, `formatRelative`, `formatDuration(startIso, endIso)`.

## 6. Design tokens (`src/app/globals.css`)

Use tokens, not raw palette classes (`text-emerald-600` etc. are not allowed for semantics).

| Purpose | Classes |
|---|---|
| Page / raised surface / tinted band | `bg-background`, `bg-card`, `bg-surface` |
| Text | `text-foreground`, `text-muted-foreground` |
| Hairlines | `border` (uses `--border`); cards use `ring-1 ring-foreground/10` |
| Accent (one indigo) | `bg-primary text-primary-foreground` (buttons), `text-brand`, `bg-brand-subtle`, `border-brand-border` |
| Verdicts | `text-match` / `bg-match-subtle` / `border-match-border`; same for `nonmatch`, `inconclusive`, `unsuitable` |
| Status (non-verdict) | `success`, `warning`, `danger` with the same three suffixes |
| Destructive actions | `text-destructive`, Button `variant="destructive"` |
| Charts | `var(--chart-1)` ... `var(--chart-5)` through shadcn `ChartContainer` |

- Radius: `rounded-md` (controls), `rounded-lg` (cards, panels), `rounded-xl` (large marketing cards).
- Type: Geist Sans everywhere; `font-mono` (Geist Mono) for hashes, ids, statistics and code.
  Numerals are tabular globally. Page title `text-xl sm:text-2xl font-semibold tracking-tight`,
  panel title `text-sm font-medium`, body `text-sm`, captions `text-xs text-muted-foreground`,
  small caps label `.eyebrow`.
- Layout helpers: `.container-page` (max 1200px + gutters; the app shell already wraps pages in
  it), `.prose-st` (long-form copy), `.bg-dot-grid`.
- Card pattern: `rounded-lg bg-card ring-1 ring-foreground/10` with a `h-11 border-b px-4` header
  (see `Panel` in `components/dashboard/dashboard.tsx`), or shadcn `Card`. Do not nest cards.
- Spacing rhythm: `gap-6` between page sections, `gap-3` in dense grids, `p-4` inside panels.
- Motion: `animate-fade-up` / `animate-fade-in` (200 ms / 160 ms), `transition-colors`. Reduced
  motion is handled globally.
- Dark mode: tokens switch automatically; avoid `dark:` overrides unless swapping an icon.
- Colour is never the only signal: pair it with an icon and a text label.

## 7. Accessibility checklist

One `<h1>` per page (from `PageHeader`), then `h2`/`h3` in order. Icon-only buttons need
`aria-label`; decorative icons need `aria-hidden="true"`. Images need `alt`. Tables need `caption`
(DataTable requires it). Announce async results with `aria-live="polite"` or `role="alert"`.
Charts need a text summary or a table. Check 360 px width and both themes before you finish.
