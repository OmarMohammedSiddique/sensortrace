import type { Metadata } from "next";
import Link from "next/link";

import { DocLayout, DocSection, PageHero } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Privacy and responsible use",
  description: "How SensorTrace handles your data, and the conditions under which it should be used.",
};

const TOC = [
  { id: "private", label: "Private by default" },
  { id: "no-telemetry", label: "Analytics and third parties" },
  { id: "stored", label: "What is stored" },
  { id: "control", label: "Export, retention, deletion" },
  { id: "sessions", label: "Sessions and tokens" },
  { id: "authorised", label: "Authorised use only" },
  { id: "responsible", label: "Using results responsibly" },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Privacy and responsible use"
        title="Your material stays yours, and the method has conditions"
        description="A sensor fingerprint can link photographs to a physical device, and therefore often to a person. This page explains how SensorTrace limits what it holds and exposes, and what it expects of the people who use it."
      />
      <DocLayout toc={TOC}>
        <DocSection id="private" title="Private by default">
          <p>
            Everything you add (devices, reference images, fingerprints, evidence, analyses, notes and reports) belongs
            to your account and is visible only to it. There is no sharing feature that is on by default and no way
            for another account to search your data.
          </p>
          <p>
            <strong>There is no public fingerprint directory.</strong> SensorTrace does not maintain, publish or query
            a shared database of sensor fingerprints, and it cannot be used to look up who owns a camera. An image can
            only be compared with sensors that you have enrolled yourself from reference images in your possession.
          </p>
          <p>
            Files are served through signed links that expire after five minutes and are bound to your account, so
            a copied link is useless to anyone else.
          </p>
        </DocSection>

        <DocSection id="no-telemetry" title="Analytics and third-party requests">
          <p>
            The application contains no tracking pixels, advertising or error-reporting services, and your browser
            makes no request to any other origin when you use SensorTrace: scripts, styles and fonts load from this
            server only, which is enforced by a content security policy, and pages are sent with a no-referrer policy.
            Your images, fingerprints and results are never included in any measurement.
          </p>
          <p>
            A self-hosted installation collects no usage data at all. The hosted deployment on Vercel records
            aggregate page views and page-load performance with Vercel Web Analytics and Speed Insights. These use
            no cookies, store no identifier in your browser and are sent to this site&apos;s own address; they show
            which pages are visited and how fast they load, not who visited or what was uploaded. Record identifiers
            and query strings are removed from page addresses before they are reported.
          </p>
          <p>
            The session cookie that keeps you signed in is not readable by scripts and is used for nothing else. A
            companion cookie records only that a session exists, so public pages need not ask the server. Two
            interface preferences are remembered in your browser: the colour theme (local storage) and whether the
            sidebar is collapsed (a cookie). None of these carries an identifier.
          </p>
        </DocSection>

        <DocSection id="stored" title="What is stored">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Account:</strong> your email address, display name and a salted hash of your password.</li>
            <li>
              <strong>Images:</strong> the exact bytes you upload, their SHA-256, dimensions, embedded metadata (which
              may include the capture time, device and location recorded by the camera) and a reduced-size preview.
            </li>
            <li><strong>Fingerprints:</strong> the estimated noise pattern for each sensor, with its diagnostics.</li>
            <li><strong>Results:</strong> measurements, outcomes, visualisations and generated reports.</li>
            <li>
              <strong>Audit history:</strong> a log of actions on your account, such as sign-ins, uploads, analyses and
              deletions, with the time and the network address they came from.
            </li>
          </ul>
          <p>
            Photographs can contain personal data about the people in them and about whoever took them. You are
            responsible for having a lawful basis to upload and process the images you add.
          </p>
        </DocSection>

        <DocSection id="control" title="Export, retention and deletion">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Export.</strong> You can export a single investigation or your entire account as an archive from the app.</li>
            <li>
              <strong>Retention.</strong> An investigation can be given a retention period. When it ends, the
              investigation and its evidence are removed automatically. You can set a default period for new
              investigations.
            </li>
            <li>
              <strong>Deletion.</strong> Devices, sensors, fingerprints, evidence, analyses and reports can be deleted
              individually. Deleting an item removes its stored files.
            </li>
            <li>
              <strong>Account deletion.</strong> You can delete your account from the settings page after confirming
              your password. This removes the account and everything stored under it and cannot be undone.
            </li>
          </ul>
          <p>
            If this server is operated by an organisation, its administrator is responsible for backups and for any
            additional retention rules, and can tell you how long backups are kept.
          </p>
        </DocSection>

        <DocSection id="sessions" title="Sessions and API tokens">
          <p>
            You can see your active sessions and revoke any of them. API tokens are shown once when created, stored
            only as a hash, can be given an expiry date and can be revoked at any time. State-changing requests from
            the browser require an anti-forgery token in addition to the session cookie.
          </p>
        </DocSection>

        <DocSection id="authorised" title="Authorised use only">
          <p>Use SensorTrace only where you are entitled to examine the material:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Enrol cameras that you own, or that you are authorised to examine.</li>
            <li>Analyse images that you hold lawfully and have a legitimate reason to examine.</li>
            <li>
              Do not use it to de-anonymise, track, harass or expose people: for example, to link anonymous
              photographs to a journalist&apos;s source, a whistleblower, an activist or a private individual without
              legal authority.
            </li>
            <li>Follow the law, professional rules and data-protection requirements that apply where you work.</li>
          </ul>
        </DocSection>

        <DocSection id="responsible" title="Using results responsibly">
          <p>
            A result from SensorTrace is a statistical indication that an image is, or is not, consistent with an
            enrolled sensor&apos;s noise pattern. It is not proof of origin, and it says nothing about who operated a
            camera, when, or why.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Do not present a result as a certainty, a probability or an identification.</li>
            <li>Report the reasons, caveats and policy status shown with each outcome, not the outcome alone.</li>
            <li>Treat a result as one piece of information to be weighed with other evidence by a qualified person.</li>
            <li>
              SensorTrace is not certified or accredited and makes no claim that its output is admissible as evidence
              in any jurisdiction.
            </li>
          </ul>
          <p>
            The <Link href="/methodology#limitations">limitations</Link> explain when the method is unreliable.
          </p>
        </DocSection>
      </DocLayout>
    </>
  );
}
