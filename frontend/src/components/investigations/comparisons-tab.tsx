"use client";

import { GitCompareArrows, ScanSearch } from "lucide-react";
import Link from "next/link";

import { AnalysesTable } from "@/components/analyses/analyses-table";
import { EmptyState } from "@/components/st/states";
import { Button } from "@/components/ui/button";

export function ComparisonsTab({ investigationId }: { investigationId: string }) {
  const newComparison = (
    <Button asChild>
      <Link href={`/app/compare?investigation=${investigationId}`}>
        <GitCompareArrows aria-hidden="true" />
        New comparison
      </Link>
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each comparison tests one image against one or more enrolled sensor fingerprints and keeps a snapshot of the fingerprints it used.
        </p>
        {newComparison}
      </div>
      <AnalysesTable
        params={{ investigation_id: investigationId }}
        pageSize={25}
        caption="Comparisons in this investigation"
        empty={
          <EmptyState
            icon={ScanSearch}
            title="No comparisons yet"
            description="Compare a questioned image from this investigation with the sensors you have enrolled."
            action={newComparison}
          />
        }
      />
    </div>
  );
}
