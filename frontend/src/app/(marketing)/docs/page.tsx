import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/marketing/code-block";
import { EngineFacts, ReferenceGuidanceList } from "@/components/marketing/meta-sections";
import { DocLayout, DocSection, PageHero } from "@/components/marketing/section";
import { VerdictBadge } from "@/components/st/verdict-badge";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Quick start, reference-image guidance, how to read results, and API usage for SensorTrace.",
};

const TOC = [
  { id: "quick-start", label: "Quick start" },
  { id: "reference-images", label: "Reference images" },
  { id: "questioned-images", label: "Questioned images" },
  { id: "results", label: "Interpreting results" },
  { id: "controls", label: "Same-model controls" },
  { id: "api", label: "API usage" },
  { id: "server", label: "This server" },
];

const QUICK_START = [
  {
    title: "Register a camera",
    body: "In Cameras, add the device with its make and model, and say whether its processing pipeline is conventional, computational or unknown. If in doubt for a phone, choose computational.",
  },
  {
    title: "Add a sensor and reference images",
    body: "Add one sensor per lens you want to test (for example the main 1x camera). Upload reference images taken with that lens, following the guidance below.",
  },
  {
    title: "Estimate the fingerprint",
    body: "Start fingerprint estimation. It runs in the background and reports which reference images were used or rejected and why, together with the fingerprint's diagnostics.",
  },
  {
    title: "Create an investigation and add the questioned image",
    body: "Create an investigation, upload the image in question as questioned evidence and record how you obtained it.",
  },
  {
    title: "Compare and review",
    body: "In Compare, choose the questioned image and the sensors to test it against. Review each candidate's outcome with its reasons and caveats, then generate a report if you need one.",
  },
];

const CURL_TOKEN = `# Create a token in the app under Settings > Security, then:
export SENSORTRACE_URL="https://your-sensortrace-host"
export SENSORTRACE_TOKEN="st_..."

# List your enrolled sensors that have a ready fingerprint
curl -sS "$SENSORTRACE_URL/api/v1/sensors?ready=true" \\
  -H "Authorization: Bearer $SENSORTRACE_TOKEN"`;

const CURL_UPLOAD = `# Upload a questioned image (repeat -F "files=@..." for several)
curl -sS -X POST "$SENSORTRACE_URL/api/v1/evidence" \\
  -H "Authorization: Bearer $SENSORTRACE_TOKEN" \\
  -F "files=@questioned.jpg" \\
  -F "category=questioned"`;

const CURL_ANALYSE = `# Compare it with two sensors, then poll the job until it finishes
curl -sS -X POST "$SENSORTRACE_URL/api/v1/analyses" \\
  -H "Authorization: Bearer $SENSORTRACE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"evidence_ids": ["<evidence-id>"], "sensor_ids": ["<sensor-id>", "<sensor-id>"]}'

curl -sS "$SENSORTRACE_URL/api/v1/jobs/<job-id>" \\
  -H "Authorization: Bearer $SENSORTRACE_TOKEN"

curl -sS "$SENSORTRACE_URL/api/v1/analyses/<analysis-id>" \\
  -H "Authorization: Bearer $SENSORTRACE_TOKEN"`;

export default function DocsPage() {
  return (
    <>
      <PageHero
        eyebrow="Documentation"
        title="Using SensorTrace"
        description="How to enrol a camera well, what to expect from a questioned image, how to read a result, and how to drive everything through the API."
      />
      <DocLayout toc={TOC}>
        <DocSection id="quick-start" title="Quick start">
          <ol className="not-prose flex flex-col">
            {QUICK_START.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                {i < QUICK_START.length - 1 ? (
                  <span aria-hidden="true" className="absolute top-8 bottom-0 left-[0.8125rem] w-px bg-border" />
                ) : null}
                <span className="z-10 flex size-[1.625rem] shrink-0 items-center justify-center rounded-full bg-card font-mono text-xs text-foreground ring-1 ring-foreground/15">
                  {i + 1}
                </span>
                <div className="pt-0.5">
                  <h3 className="text-sm font-medium text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p>
            To see the workflow before photographing anything, load the synthetic demo data from the dashboard. Demo
            items are marked <strong>Synthetic demo</strong> wherever they appear and can be removed in one step.
          </p>
        </DocSection>

        <DocSection id="reference-images" title="Reference-image guidance">
          <p>
            The quality of a fingerprint is decided by its reference images. The guidance below is published by the
            analysis engine of this server.
          </p>
          <div className="not-prose">
            <ReferenceGuidanceList />
          </div>
        </DocSection>

        <DocSection id="questioned-images" title="Questioned images">
          <p>
            The method works on the pixel grid of the sensor, so what matters most is how close the file is to what
            the camera wrote.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Use the original file</strong> whenever it exists. Copies sent through messaging apps or social platforms are normally resized and recompressed, which weakens or destroys the pattern.</li>
            <li><strong>Resized and digitally zoomed images cannot be matched.</strong> They are not registered to the fingerprint, and a low statistic for such an image means nothing.</li>
            <li><strong>Crops</strong> are searched over every possible position. This is experimental and needs a larger statistic to reach the same outcome, because many positions are tested.</li>
            <li><strong>Screenshots and edited images</strong> may no longer contain the sensor pattern at all.</li>
            <li>Record how each file was obtained in its acquisition details. The file&apos;s SHA-256 is computed on upload and shown with every result.</li>
          </ul>
          <p>
            Each image receives quality flags at three levels (note, warning, severe). Flags inform you and limit what
            the decision policy may conclude. They are heuristics, not findings.
          </p>
        </DocSection>

        <DocSection id="results" title="Interpreting results">
          <p>Read a result in this order:</p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong>The outcome</strong> for each candidate sensor, which is one of:
              <span className="not-prose mt-2 flex flex-wrap gap-2">
                <VerdictBadge verdict="match_supported" size="sm" />
                <VerdictBadge verdict="non_match_supported" size="sm" />
                <VerdictBadge verdict="inconclusive" size="sm" />
                <VerdictBadge verdict="insufficient_or_unsupported" size="sm" />
              </span>
            </li>
            <li>
              <strong>The reasons.</strong> Every outcome lists the rules that produced it. They tell you, for
              instance, that a low statistic was not read as a non-match because the image is too small.
            </li>
            <li>
              <strong>The caveats</strong> that apply to this result, and <strong>the policy status</strong>. With an
              uncalibrated policy the thresholds are reference lines and no error rate is available.
            </li>
            <li>
              <strong>The measurement.</strong> PCE is the detection statistic; the adjusted statistic is the same
              value corrected for the number of hypotheses tested. Neither is a percentage or a probability. Larger
              is stronger, there is no upper limit, and values near zero or negative are what unrelated sensors
              produce.
            </li>
            <li>
              <strong>The correlation surface.</strong> A genuine match appears as one sharp peak at the centre. A
              broad bump, a peak away from the centre or a regular texture suggests something other than the sensor
              pattern.
            </li>
          </ol>
          <p>
            An <em>inconclusive</em> or <em>insufficient</em> outcome is a normal and frequent result. It means the
            analysis could not support a conclusion, not that the image came from somewhere else. When several
            sensors exceed the match line for the same image, no single source should be concluded.
          </p>
        </DocSection>

        <DocSection id="controls" title="Same-model control devices">
          <p>
            For a device whose pipeline is computational or unknown, a high statistic can be caused by processing
            shared across the model rather than by the individual sensor. If a result says that the same-model
            alternative has not been addressed:
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Obtain a second physical device of the <strong>same make and model</strong>, ideally on the same software version.</li>
            <li>Register it with exactly the same make and model text, enrol the same lens and build its fingerprint from reference images taken the same way.</li>
            <li>Run the comparison again with both sensors selected.</li>
          </ol>
          <p>
            If the control stays low while the candidate is high, the outcome can support a match, labelled as
            control-based. If the control is also high, the outcome is inconclusive for both. More controls give a
            better check; one control cannot exclude artefacts shared with other units.
          </p>
        </DocSection>

        <DocSection id="api" title="API usage">
          <p>
            The app is a client of a documented HTTP API. The interactive reference, generated from the server&apos;s
            OpenAPI description, is at{" "}
            <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer">
              /api/v1/docs
            </a>
            .
          </p>
          <p>
            Authenticate scripts with a personal access token sent as a bearer token. Tokens are created under
            Settings, shown once, and can be revoked at any time. Keep them out of source control.
          </p>
          <div className="not-prose flex flex-col gap-3">
            <CodeBlock code={CURL_TOKEN} label="Copy token example" />
            <CodeBlock code={CURL_UPLOAD} label="Copy upload example" />
            <CodeBlock code={CURL_ANALYSE} label="Copy analysis example" />
          </div>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Lists return <code>items</code>, <code>total</code>, <code>limit</code> and <code>offset</code>.</li>
            <li>Errors return <code>{`{"error": {"code", "message", "details"}}`}</code> with a matching HTTP status.</li>
            <li>Long operations return a <code>job</code>. Poll <code>GET /api/v1/jobs/{"{id}"}</code> until its status is <code>succeeded</code>, <code>failed</code> or <code>cancelled</code>.</li>
            <li>File links in responses are signed and expire after five minutes. Fetch the parent object again for a fresh link.</li>
          </ul>
        </DocSection>

        <DocSection id="server" title="This server">
          <p>Versions and limits reported by the server you are connected to:</p>
          <div className="not-prose">
            <EngineFacts />
          </div>
          <p>
            The scientific background is on the <Link href="/methodology">methodology</Link> page.
          </p>
        </DocSection>
      </DocLayout>
    </>
  );
}
