# SensorTrace product direction

## Register

product

## Purpose

SensorTrace tests whether a photograph is consistent with the noise fingerprint of a specific physical
camera sensor, using photo-response non-uniformity (PRNU). A user enrols a sensor from reference
photographs, compares questioned images against it, and receives the measurements, a conservative
outcome, the reasons and the limitations that apply, plus a PDF report.

It is a careful measuring instrument, not an oracle. It does not identify an unknown camera from a single
image, it never outputs a probability of origin, and it is not certified forensic software. Every surface
must leave the user with an accurate idea of what a result does and does not mean.

## Users

- **Investigators and analysts** who are authorised to examine the images they upload and need a
  transparent, reproducible comparison with its limits stated.
- **Researchers and students** in image forensics who want an open, documented PRNU implementation and
  an evaluation they can reproduce (`make evaluate`).
- **Operators** who run their own instance with Docker Compose or on Vercel and are responsible for its
  configuration (see `DEPLOYMENT.md` and `SECURITY.md`).

Each account's data is private. There is no sharing, no public fingerprint directory and no
cross-account matching.

## Register and tone

- Precise, sober and plain. Write as a methodical colleague explaining a measurement, not as a
  marketer.
- Lead with what was measured, then the outcome, then the reasons and limitations. Keep limitations
  next to the result, never only on a separate page.
- Be specific about scope: "camera-original JPEG from smartphones of 2011 to 2016" rather than "most
  photos".
- Distinguish a camera model from a physical sensor in every sentence where both could be meant.
- British English. No em dashes or double hyphens. Short sentences; no exclamation marks.

### Words to use and avoid

| Use | Avoid |
|---|---|
| The four outcome labels exactly: "Evidence supports a match", "Evidence supports a non-match", "Inconclusive", "Insufficient quality or unsupported analysis" | "Identified", "confirmed", "proven", "certain", "matched" as a conclusion |
| "Consistent with", "supports", "the statistic" | "Confidence", any percentage or probability of origin |
| "Experimental", "not validated" for anything without empirical validation | Implied accuracy from synthetic data |
| "Synthetic demo" for onboarding data | Presenting demo data as a real case |

Never claim courtroom admissibility, certification or accreditation.

## Brand rules

- **Name.** "SensorTrace", one word, capital S and T. The engine package is `sensortrace_engine` and the
  CLI is `sensortrace`.
- **Typeface.** Geist Sans for all interface and display text; Geist Mono for hashes, identifiers,
  statistics and code. Numerals are tabular.
- **Colour.** One indigo accent (`--primary` and `--brand` in `frontend/src/app/globals.css`) on quiet
  neutral surfaces, with coherent light and dark themes. Use tokens, never raw palette classes.
- **Outcome colours** are reserved for outcomes: `match` (green), `nonmatch` (red), `inconclusive`
  (amber) and `unsuitable` (grey). Do not reuse them for decoration or for unrelated status.
- **Colour is never the only signal.** Every outcome and status pairs colour with an icon and a text
  label.
- **Shape.** Moderate radius (`rounded-md` controls, `rounded-lg` panels), hairline borders, no nested
  cards.
- **Motion.** Brief fades (160 to 200 ms) only; reduced motion is respected globally.
- **Imagery.** Noise residuals and fingerprints are shown with the API's visualisation notice. Media
  that uses illustrative data says so (see `docs/media/README.md`).

The full component and token reference for page authors is `frontend/CONVENTIONS.md`.

## Accessibility

Meet WCAG AA contrast in both themes. One `<h1>` per page, labelled controls, keyboard access and
visible focus. Tables carry captions and charts carry a text summary. Check 360 px width and both themes
before finishing a change.

## Anti-patterns

Probability or likelihood-ratio output; camera-model identification presented as sensor
identification; telemetry or third-party requests from the application (Vercel Web Analytics and Speed
Insights run only in the hosted build and never see uploaded images or fingerprints); hype words;
decorative use of outcome colours; results shown without reasons, caveats and the policy status.
