"use client";

import { GitCompareArrows, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { AnalysesTable } from "@/components/analyses/analyses-table";
import { Panel } from "@/components/investigations/panel";
import { PageHeader } from "@/components/st/page-header";
import { PolicyNotice } from "@/components/st/policy-notice";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import { useApiMutation, useInvestigations, useMeta, usePolicies, useSensors } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { AnalysisIn, AnalysisStarted, Evidence, Policy } from "@/lib/api/types";
import { pluralize } from "@/lib/format";
import { toastError } from "@/lib/toast";

import { EvidenceStep, useSelectedEvidence } from "./evidence-step";
import { RunResults, type StartedRun } from "./run-results";
import { SelectionGuidance, SensorStep } from "./sensor-step";

const NO_INVESTIGATION = "none";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-brand-subtle font-mono text-xs text-brand ring-1 ring-brand-border">
        {n}
      </span>
      <span>
        <span className="sr-only">Step {n}: </span>
        {children}
      </span>
    </>
  );
}

function PolicyScope({ policy }: { policy: Policy }) {
  const calibration = policy.calibration as Record<string, unknown> | null;
  const keys = Array.isArray(calibration?.model_keys) ? (calibration.model_keys as unknown[]).map(String) : [];
  if (!policy.calibrated) {
    return <p className="text-xs leading-relaxed text-muted-foreground">Scope: not calibrated for any camera model. The lines apply as general reference values only.</p>;
  }
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Scope of the calibration: {keys.length > 0 ? keys.join("; ") : "no camera models listed"}. For sensors of other models the thresholds are
      reference lines only.
    </p>
  );
}

export function CompareLab() {
  const id = useId();
  const searchParams = useSearchParams();
  const paramEvidence = searchParams.get("evidence");
  const paramInvestigation = searchParams.get("investigation");

  const [evidenceIds, setEvidenceIds] = useState<string[]>(() => (paramEvidence && UUID.test(paramEvidence) ? [paramEvidence] : []));
  const [sensorIds, setSensorIds] = useState<string[]>([]);
  const [policyChoice, setPolicyChoice] = useState<string | null>(null);
  const [investigationChoice, setInvestigationChoice] = useState<string>(() => (paramInvestigation && UUID.test(paramInvestigation) ? paramInvestigation : NO_INVESTIGATION));
  const [runs, setRuns] = useState<StartedRun[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);

  const meta = useMeta();
  const sensors = useSensors({ ready: true, limit: 500 });
  const policies = usePolicies();
  const investigations = useInvestigations({ limit: 200 });
  const queryClient = useQueryClient();
  // Same request as `useStartAnalyses`, but the lists are refreshed in the background so the
  // progress rows appear as soon as the jobs are queued.
  const start = useApiMutation((body: AnalysisIn) => unwrap<AnalysisStarted>(api.POST("/api/v1/analyses", { body: body as never })));

  const investigationList = investigations.data?.items;
  // An investigation id from the URL that does not exist (any more) is ignored.
  const investigationId =
    investigationChoice !== NO_INVESTIGATION && (!investigationList || investigationList.some((i) => i.id === investigationChoice)) ? investigationChoice : null;
  const policy = policies.data?.find((p) => p.policy_id === policyChoice) ?? policies.data?.[0];

  const selectedEvidence = useSelectedEvidence(evidenceIds);
  const images = selectedEvidence.flatMap((r) => (r.data ? [r.data] : [])) as Evidence[];
  const selectedSensors = (sensors.data?.items ?? []).filter((s) => sensorIds.includes(s.id));
  const validSensorIds = selectedSensors.map((s) => s.id);
  const validEvidenceIds = evidenceIds.filter((eid, i) => !selectedEvidence[i]?.isError);

  const missing: string[] = [];
  if (validEvidenceIds.length === 0) missing.push("select at least one questioned image");
  if (validSensorIds.length === 0) missing.push("select at least one reference sensor");
  if (!policy) missing.push("wait for the decision policy to load");
  const canRun = missing.length === 0 && !start.isPending;

  const run = () => {
    if (!canRun || !policy) return;
    start.mutate(
      { evidence_ids: validEvidenceIds, sensor_ids: validSensorIds, policy_id: policy.policy_id, investigation_id: investigationId },
      {
        onSuccess: (res) => {
          const jobByAnalysis = new Map(res.jobs.map((j) => [j.target_id, j.id]));
          for (const job of res.jobs) queryClient.setQueryData(qk.jobs.detail(job.id), job);
          for (const queryKey of [qk.analyses.lists(), qk.jobs.lists(), qk.dashboard, qk.investigations.all]) void queryClient.invalidateQueries({ queryKey });
          const started = res.analyses.map((a) => ({
            analysisId: a.id,
            jobId: jobByAnalysis.get(a.id) ?? a.job_id ?? null,
            filename: a.evidence_filename || "Untitled image",
          }));
          setRuns((previous) => [...started, ...previous]);
          if (started.length < validEvidenceIds.length) {
            toastError(
              new Error(`Only ${started.length} of ${validEvidenceIds.length} comparisons could be queued. Start the remaining images again once these finish.`),
              "Some comparisons were not started",
            );
          }
          requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
        },
        onError: (err) => toastError(err, "Could not start the comparison"),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Comparison laboratory"
        description="Test questioned images against the fingerprints of enrolled sensors. Each image is compared with every sensor you select, and each pair gets its own measurement, outcome, reasons and limitations."
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title={<StepTitle n={1}>Questioned images</StepTitle>}>
          <EvidenceStep
            selected={evidenceIds}
            onChange={setEvidenceIds}
            investigationId={investigationId}
            investigations={investigationList}
            initialTab={paramInvestigation && !paramEvidence ? "existing" : "upload"}
          />
        </Panel>

        <Panel title={<StepTitle n={2}>Reference sensors</StepTitle>}>
          <div className="flex flex-col gap-4">
            <SensorStep query={sensors} selected={sensorIds} onChange={setSensorIds} maxCandidates={meta.data?.limits.max_candidates_per_analysis} />
            <SelectionGuidance sensors={selectedSensors} images={images} />
          </div>
        </Panel>

        <Panel title={<StepTitle n={3}>Policy and destination</StepTitle>} className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-policy`}>Decision policy</Label>
              {policies.isError ? (
                <ErrorState variant="inline" error={policies.error} title="Could not load policies" onRetry={() => void policies.refetch()} retrying={policies.isFetching} />
              ) : !policies.data ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <>
                  <Select value={policy?.policy_id ?? ""} onValueChange={setPolicyChoice}>
                    <SelectTrigger id={`${id}-policy`} className="w-full font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {policies.data.map((p) => (
                        <SelectItem key={p.policy_id} value={p.policy_id} className="font-mono text-xs">
                          {p.policy_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    The policy turns each measured statistic into one of four outcomes. It never produces a probability.
                  </p>
                  {policy ? (
                    <>
                      <PolicyNotice policy={policy} />
                      <PolicyScope policy={policy} />
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-investigation`}>Save results into</Label>
              {investigations.isError ? (
                <ErrorState variant="inline" error={investigations.error} title="Could not load investigations" onRetry={() => void investigations.refetch()} retrying={investigations.isFetching} />
              ) : !investigationList ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <Select value={investigationId ?? NO_INVESTIGATION} onValueChange={setInvestigationChoice}>
                  <SelectTrigger id={`${id}-investigation`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_INVESTIGATION}>Each image&apos;s own investigation, if any</SelectItem>
                    {investigationList.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {investigationId
                  ? "The comparisons are filed in this investigation. Images you upload in step 1 are filed there too."
                  : "A comparison stays with the investigation its image belongs to. Images outside any investigation produce standalone results that you can file later."}
              </p>
            </div>

            <div className="border-t pt-4">
              <Button size="lg" className="w-full" disabled={!canRun} onClick={run} aria-describedby={`${id}-run-help`}>
                <GitCompareArrows aria-hidden="true" />
                {start.isPending ? "Starting" : "Run comparison"}
              </Button>
              <p id={`${id}-run-help`} className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
                {missing.length > 0
                  ? `To run: ${missing.join(", and ")}.`
                  : `${pluralize(validEvidenceIds.length, "image")} × ${pluralize(validSensorIds.length, "sensor")}: one background job per image.`}
              </p>
            </div>
            </div>
          </div>
        </Panel>
      </div>

      <div ref={resultsRef} className="mt-6 scroll-mt-20">
        {runs.length > 0 ? (
          <Panel title="This session's runs" icon={GitCompareArrows} flush action={<span className="text-xs text-muted-foreground">{pluralize(runs.length, "comparison")}</span>}>
            <RunResults runs={runs} />
          </Panel>
        ) : null}
      </div>

      <section aria-labelledby={`${id}-recent`} className="mt-8">
        <h2 id={`${id}-recent`} className="mb-3 text-sm font-medium">
          Recent comparisons
        </h2>
        <AnalysesTable
          caption="Recent comparisons"
          pageSize={10}
          empty={
            <EmptyState
              icon={ScanSearch}
              title="No comparisons yet"
              description="Results of the comparisons you run appear here."
              secondaryAction={
                <Button asChild variant="outline">
                  <Link href="/docs">How to read a result</Link>
                </Button>
              }
            />
          }
        />
      </section>
    </>
  );
}
