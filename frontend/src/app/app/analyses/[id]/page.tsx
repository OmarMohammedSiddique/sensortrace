import type { Metadata } from "next";

import { AnalysisResult } from "@/components/analyses/analysis-result";

export const metadata: Metadata = { title: "Comparison result" };

export default function AnalysisPage() {
  return <AnalysisResult />;
}
