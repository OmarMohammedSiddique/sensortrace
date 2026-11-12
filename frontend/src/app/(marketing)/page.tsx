import { Camera, Check, FileSearch, ImagePlus, Minus, ScanSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { GetStarted } from "@/components/marketing/cta";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SignalIllustration } from "@/components/marketing/signal-illustration";
import { VerdictBadge } from "@/components/st/verdict-badge";
import type { Verdict } from "@/lib/api/types";

export const metadata: Metadata = {
  title: { absolute: "SensorTrace - Is this photograph consistent with this camera sensor?" },
};

const STEPS = [
  {
    icon: Camera,
    title: "Enrol a sensor",
    body: "Register a camera you have access to and upload reference photographs taken with one of its lenses. SensorTrace screens the set, estimates the sensor's noise fingerprint and records how internally consistent it is.",
  },
  {
    icon: ImagePlus,
    title: "Add a questioned image",
    body: "Upload the photograph whose origin is in question. The original bytes are hashed and stored unmodified, and the image is assessed for conditions that weaken the analysis, such as resizing, heavy compression or clipping.",
  },
  {
    icon: FileSearch,
    title: "Review the evidence",
    body: "The image is compared with the fingerprints you select. Each comparison reports the statistic, the correlation surface, a conservative outcome, the reasons for it and the caveats that apply.",
  },
];

const CAN = [
  "Test whether a photograph is consistent with the fingerprint of a specific sensor that you have enrolled.",
  "Compare one image against several enrolled sensors and judge each on its own, without forcing a choice.",
  "Show the measurement behind every outcome: the PCE statistic, the alignment tested and the correlation surface.",
  "Flag image conditions that limit what can be concluded, and say so in the result.",
  "Keep a hashed, timestamped record of evidence, processing history and software versions for each case.",
];

const CANNOT = [
  "Name the camera that took a photograph when that camera has not been enrolled. A single image cannot identify an arbitrary unknown device.",
  "Prove origin, or give a probability that an image came from a sensor. The outcome is a statistical indication.",
  "Rule a sensor out because a statistic is low. Editing, resizing and modern phone processing can hide a real match.",
  "Tell two phones of the same model apart on a high statistic alone. Shared processing artefacts can imitate a match, so same-model control devices are needed.",
  "Identify a camera model, analyse video, or detect that an image was generated or edited.",
];

const VERDICTS: { verdict: Verdict; body: string }[] = [
  {
    verdict: "match_supported",
    body: "The adjusted statistic reached the match line and the possibility that another device of the same model would score as high has been addressed.",
  },
  {
    verdict: "non_match_supported",
    body: "The statistic is low and the image, the geometry and the fingerprint are all good enough that a match would have been expected to show.",
  },
  {
    verdict: "inconclusive",
    body: "The statistic is between the lines, or it is low under conditions that could hide a match, or it is high without same-model controls.",
  },
  {
    verdict: "insufficient_or_unsupported",
    body: "The image cannot be meaningfully tested against this fingerprint: unsupported geometry, too few usable pixels or a severe quality problem.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div aria-hidden="true" className="bg-dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_30%,black,transparent)]" />
        <div className="container-page relative grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:py-28">
          <div className="animate-fade-up">
            <p className="eyebrow mb-4 flex items-center gap-2 text-brand">
              <ScanSearch aria-hidden="true" className="size-3.5" />
              Sensor pattern noise analysis
            </p>
            <h1 className="max-w-xl text-4xl leading-[1.08] font-semibold tracking-[-0.025em] sm:text-5xl">
              Is this photograph consistent with this camera sensor?
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Every image sensor leaves a faint, fixed noise pattern in the pictures it takes. SensorTrace estimates
              that pattern from a camera you enrol, tests a questioned photograph against it, and reports the
              statistic together with its reasons and its limits.
            </p>
            <div className="mt-8">
              <GetStarted secondary={{ href: "/methodology", label: "Read the methodology" }} />
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["Private by default", "No third-party requests", "Published method and limitations"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-3.5 text-brand" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <SignalIllustration className="animate-fade-up shadow-sm [animation-delay:80ms]" />
        </div>
      </section>

      {/* How it works */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Three steps from a camera to a documented result"
          description="The method links an image to a sensor you have enrolled. Without reference images from a candidate camera there is nothing to compare against."
        />
        <ol className="mt-10 grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative bg-card p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand ring-1 ring-brand-border">
                  <step.icon aria-hidden="true" className="size-[1.125rem]" />
                </span>
                <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-base font-medium">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Can / cannot */}
      <Section band>
        <SectionHeading
          eyebrow="Honest scope"
          title="What it can and cannot tell you"
          description="Sensor noise analysis is a well-studied technique with real limits. SensorTrace is built to state them rather than hide them."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-7">
            <h3 className="text-base font-medium">It can</h3>
            <ul className="mt-4 flex flex-col gap-3.5">
              {CAN.map((t) => (
                <li key={t} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-7">
            <h3 className="text-base font-medium">It cannot</h3>
            <ul className="mt-4 flex flex-col gap-3.5">
              {CANNOT.map((t) => (
                <li key={t} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Minus aria-hidden="true" className="size-3" />
                  </span>
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Outcomes */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <SectionHeading
            eyebrow="Outcomes"
            title="Four carefully worded outcomes, never a percentage"
            description={
              <>
                Each comparison ends in one of four outcomes, always shown with the reasons that led to it, the
                caveats that apply, and whether the thresholds are calibrated. Poor image quality can prevent a
                non-match conclusion but can never create a match.{" "}
                <Link href="/methodology#decision" className="text-brand underline underline-offset-4">
                  How outcomes are decided
                </Link>
              </>
            }
          />
          <dl className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {VERDICTS.map((v) => (
              <div key={v.verdict} className="grid gap-2 p-5 sm:grid-cols-[15rem_1fr] sm:items-start sm:gap-6">
                <dt>
                  <VerdictBadge verdict={v.verdict} wrap />
                </dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{v.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* Model vs sensor */}
      <Section band>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <SectionHeading
            eyebrow="Model is not sensor"
            title="A camera model is a product. A sensor is one physical component."
            description="Thousands of cameras share a model name, firmware and image processing. The pattern SensorTrace measures belongs to one individual sensor, so each lens of a multi-camera phone is enrolled separately."
          />
          <div className="prose-st">
            <p>
              On many phones released since about 2018, multi-frame fusion, HDR, lens correction and synthetic blur
              add structure to images that is <strong>common to every unit of the model</strong>. Published studies
              have measured high statistics between different devices of the same model for that reason.
            </p>
            <p>
              SensorTrace therefore asks you to declare each device&apos;s processing pipeline. For a device that is
              not declared conventional, a high statistic supports a match only when another physical device of the
              same make and model was enrolled as a control and stayed low, or when the decision policy has been
              calibrated for that model. Otherwise the outcome is inconclusive, and the result explains why.
            </p>
            <p>
              <Link href="/methodology#same-model">Read about the same-model alternative</Link>
            </p>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="flex flex-col items-start justify-between gap-8 rounded-xl bg-card p-8 ring-1 ring-foreground/10 sm:p-10 lg:flex-row lg:items-center">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight">Start with a camera you can hold</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Create an account, register a camera and photograph an evenly lit wall thirty times. A synthetic demo
              data set is available if you want to see the workflow first.
            </p>
          </div>
          <GetStarted secondary={{ href: "/docs", label: "Quick start" }} />
        </div>
      </Section>
    </>
  );
}
