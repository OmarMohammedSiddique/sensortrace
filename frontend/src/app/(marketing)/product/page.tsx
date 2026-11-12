import {
  Activity,
  Camera,
  FileText,
  FolderSearch,
  GitCompareArrows,
  History,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  Scale,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { GetStarted } from "@/components/marketing/cta";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Product",
  description: "What SensorTrace does: a camera laboratory, investigations, a comparison laboratory, reports and an audit trail.",
};

const AREAS: { icon: LucideIcon; title: string; body: string; points: string[] }[] = [
  {
    icon: Camera,
    title: "Camera laboratory",
    body: "Register the devices you can examine and build a fingerprint for each of their sensors.",
    points: [
      "A device holds one or more sensors: main, ultrawide, telephoto and front cameras are separate sensors with separate fingerprints.",
      "Reference images are screened before use. Duplicates, zoomed or clipped frames and images from a different lens or resolution are rejected with a stated reason.",
      "Each fingerprint is versioned and stored with its diagnostics, including a split-half consistency check and the hash of every reference file used.",
    ],
  },
  {
    icon: FolderSearch,
    title: "Investigations",
    body: "Keep the material for one question together: evidence, comparisons, notes and history.",
    points: [
      "Evidence images are categorised as questioned, reference or context, and stored byte-for-byte as received with their SHA-256.",
      "Acquisition details (source, who obtained the file, when and how) are recorded alongside each item.",
      "Every upload, comparison, note and deletion is written to the investigation's processing history.",
    ],
  },
  {
    icon: GitCompareArrows,
    title: "Comparison laboratory",
    body: "Test a questioned image against one or several enrolled sensors.",
    points: [
      "Candidates are ranked, but each is judged independently. Nothing forces one of your enrolled sensors to be chosen.",
      "The statistic is adjusted for the number of hypotheses tested, so adding candidates does not inflate results.",
      "For each candidate you see the measurement, the correlation surface, the outcome, its reasons and its caveats.",
    ],
  },
  {
    icon: FileText,
    title: "Reports",
    body: "Produce a PDF for a single comparison or a whole investigation.",
    points: [
      "Reports carry the method description, the software and library versions, file hashes and the decision policy in force.",
      "The wording in a report is the wording in the app: the same outcomes, reasons, caveats and limitations.",
      "Each report file is hashed so a copy can be checked later.",
    ],
  },
];

const PRINCIPLES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Scale,
    title: "Thresholds state where they come from",
    body: "The default policy uses reference lines from the research literature and says plainly that no error rate is attached to them. A calibrated policy records the data it was calibrated on and applies only there.",
  },
  {
    icon: ShieldAlert,
    title: "Quality can hide a match, never create one",
    body: "Low resolution, recompression, clipping or signs of editing restrict the conclusions that can be drawn from a low statistic. They never upgrade a result.",
  },
  {
    icon: Layers,
    title: "Model is separated from sensor",
    body: "Devices declare their processing pipeline. For modern smartphones a high statistic needs same-model control devices before it supports a match.",
  },
  {
    icon: ListChecks,
    title: "Reasons with every outcome",
    body: "Each outcome lists the rules that produced it in plain language, so a reviewer can follow the decision without reading code.",
  },
  {
    icon: History,
    title: "Reproducible",
    body: "The same algorithm version, library versions and input bytes produce the same numbers. Fingerprints carry a digest so a re-run can be checked.",
  },
  {
    icon: Lock,
    title: "Private by default",
    body: "Your images and fingerprints are visible only to your account. There is no shared or public fingerprint directory and nothing is sent to third parties.",
  },
];

const PLATFORM: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Activity,
    title: "Background jobs with live progress",
    body: "Fingerprint estimation, comparisons and exports run in the background. You can watch their stage and progress and cancel them.",
  },
  {
    icon: KeyRound,
    title: "API access",
    body: "Everything in the app is available over a documented HTTP API with personal access tokens.",
  },
  {
    icon: History,
    title: "Audit trail, export and deletion",
    body: "Account activity is logged. You can export your data as an archive, set retention periods for investigations, and delete your account with everything in it.",
  },
];

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="A workspace for sensor fingerprint examinations"
        description="SensorTrace takes the established PRNU method out of research scripts and puts it in a workspace that keeps records, explains its outcomes and is clear about what it has not shown."
      />

      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {AREAS.map((area) => (
            <article key={area.title} className="flex flex-col rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-7">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand ring-1 ring-brand-border">
                <area.icon aria-hidden="true" className="size-[1.125rem]" />
              </span>
              <h2 className="mt-5 text-lg font-medium tracking-tight">{area.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{area.body}</p>
              <ul className="mt-5 flex flex-col gap-3 border-t pt-5">
                {area.points.map((p) => (
                  <li key={p} className="flex gap-3 text-sm leading-relaxed">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section band>
        <SectionHeading
          eyebrow="Design principles"
          title="Built to be conservative"
          description="A tool that overstates its results is worse than no tool. These rules are enforced by the decision logic, not left to the reader."
        />
        <div className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title}>
              <p.icon aria-hidden="true" className="size-5 text-brand" />
              <h3 className="mt-3 text-sm font-medium">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Platform" title="The practical parts" />
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 md:grid-cols-3">
          {PLATFORM.map((p) => (
            <div key={p.title} className="bg-card p-6">
              <p.icon aria-hidden="true" className="size-5 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-xl border border-warning-border bg-warning-subtle p-6">
          <h2 className="text-sm font-medium">What SensorTrace is not</h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            SensorTrace is an analysis aid for people who understand the method. It is not certified or accredited,
            its results are not a substitute for a qualified examiner&apos;s opinion, and nothing here is a claim that
            its output is admissible as evidence in any jurisdiction. Read the{" "}
            <Link href="/methodology#limitations" className="text-foreground underline underline-offset-4">
              limitations
            </Link>{" "}
            before relying on a result.
          </p>
        </div>
        <div className="mt-10">
          <GetStarted secondary={{ href: "/methodology", label: "Read the methodology" }} />
        </div>
      </Section>
    </>
  );
}
