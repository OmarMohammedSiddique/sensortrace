import type { Metadata } from "next";
import Link from "next/link";

import { LimitationsList } from "@/components/marketing/meta-sections";
import { DocLayout, DocSection, Formula, PageHero } from "@/components/marketing/section";
import { VerdictBadge } from "@/components/st/verdict-badge";
import type { Verdict } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How SensorTrace estimates sensor fingerprints and tests images against them: noise residual, maximum-likelihood fingerprint, PCE, decision policy, limitations and references.",
};

const TOC = [
  { id: "idea", label: "The idea" },
  { id: "residual", label: "Noise residual" },
  { id: "fingerprint", label: "Fingerprint" },
  { id: "statistic", label: "Detection statistic" },
  { id: "multiple-testing", label: "Multiple testing" },
  { id: "decision", label: "Decision policy" },
  { id: "same-model", label: "Same-model alternative" },
  { id: "limitations", label: "Limitations" },
  { id: "evaluation", label: "Evaluation data" },
  { id: "references", label: "References" },
];

const OUTCOMES: { verdict: Verdict; meaning: string }[] = [
  {
    verdict: "match_supported",
    meaning: "The adjusted statistic is at or above the match line, and the same-model alternative has been addressed.",
  },
  {
    verdict: "non_match_supported",
    meaning: "The adjusted statistic is at or below the non-match line and all of these hold: the image is at native resolution, no flagged condition could hide a match, there are enough usable pixels, and the fingerprint was built from enough reference images and is internally consistent.",
  },
  {
    verdict: "inconclusive",
    meaning: "The statistic lies between the lines; or it is low under conditions that could hide a match; or it is high but the same-model alternative has not been addressed.",
  },
  {
    verdict: "insufficient_or_unsupported",
    meaning: "The geometry is unsupported, there are too few usable pixels, or a severe quality condition coincides with a statistic below the match line.",
  },
];

const REFERENCES: { id: string; text: React.ReactNode }[] = [
  {
    id: "mihcak1999",
    text: (
      <>
        Mihcak, M. K., Kozintsev, I., Ramchandran, K. (1999). Spatially adaptive statistical modeling of wavelet image
        coefficients and its application to denoising. <i>Proc. IEEE ICASSP</i>.
      </>
    ),
  },
  {
    id: "lukas2006",
    text: (
      <>
        Lukas, J., Fridrich, J., Goljan, M. (2006). Digital camera identification from sensor pattern noise.{" "}
        <i>IEEE Transactions on Information Forensics and Security</i> 1(2).
      </>
    ),
  },
  {
    id: "chen2008",
    text: (
      <>
        Chen, M., Fridrich, J., Goljan, M., Lukas, J. (2008). Determining image origin and integrity using sensor
        noise. <i>IEEE Transactions on Information Forensics and Security</i> 3(1).
      </>
    ),
  },
  {
    id: "goljan2009",
    text: (
      <>
        Goljan, M., Fridrich, J., Filler, T. (2009). Large scale test of sensor fingerprint camera identification.{" "}
        <i>Proc. SPIE</i> 7254.
      </>
    ),
  },
  {
    id: "shullani2017",
    text: (
      <>
        Shullani, D., Fontani, M., Iuliani, M., Al Shaya, O., Piva, A. (2017). VISION: a video and image dataset for
        source identification. <i>EURASIP Journal on Information Security</i> 2017:15.
      </>
    ),
  },
  {
    id: "iuliani2021",
    text: (
      <>
        Iuliani, M., Fontani, M., Piva, A. (2021). A leak in PRNU based source identification. Questioning fingerprint
        uniqueness. <i>IEEE Access</i> 9.
      </>
    ),
  },
  {
    id: "loison2026",
    text: (
      <>
        Loison, B., Bammey, Q., Ehret, T., Grompone von Gioi, R., Muse, P., Gardella, M. (2026). A new hope for PRNU on
        modern smartphones? Evidence that device-specific fingerprints survive computational photography.
        arXiv:2610.25438. <strong>Preprint, not peer reviewed.</strong>
      </>
    ),
  },
];

function Cite({ to, children }: { to: string; children: React.ReactNode }) {
  return <a href={`#ref-${to}`}>{children}</a>;
}

export default function MethodologyPage() {
  return (
    <>
      <PageHero
        eyebrow="Methodology"
        title="What SensorTrace computes, and where it stops being reliable"
        description="SensorTrace implements the sensor pattern noise method developed in the research literature since 2006. This page summarises each step, the decision rules applied to the result, and the conditions under which the method fails."
      />
      <DocLayout toc={TOC}>
        <DocSection id="idea" title="The idea">
          <p>
            The light-sensitive elements of an image sensor are not perfectly identical. Small manufacturing
            differences make each one slightly more or less sensitive than its neighbours. This{" "}
            <strong>photo-response non-uniformity (PRNU)</strong> multiplies the light that reaches the sensor, so it
            leaves a faint, fixed pattern in every photograph the sensor takes. The pattern is stable over time and
            differs between sensors, including sensors of the same camera model.
          </p>
          <p>
            Following <Cite to="chen2008">Chen et al. (2008)</Cite>, the camera output <code>I</code> is modelled as
            the noise-free image plus the PRNU term plus everything else:
          </p>
          <Formula label="I equals I zero, plus I zero times K, plus theta">
            I = I<sup>(0)</sup> + I<sup>(0)</sup>&middot;K + &Theta;
          </Formula>
          <p>
            Here <code>K</code> is the sensor&apos;s PRNU factor, which SensorTrace calls the{" "}
            <strong>fingerprint</strong>, and <code>&Theta;</code> collects all other noise. SensorTrace tests one
            hypothesis at a time: <em>is this image consistent with the fingerprint of this enrolled sensor?</em>
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>It links an image to an <strong>enrolled</strong> sensor. It cannot name an unknown camera from a single photograph.</li>
            <li>It concerns the <strong>physical sensor</strong>, not the camera model. Model identification is a different problem and is not attempted.</li>
            <li>The outcome is a <strong>statistical indication</strong>. It is not proof of origin and not a probability that the image came from the sensor.</li>
          </ul>
        </DocSection>

        <DocSection id="residual" title="Step 1: the noise residual">
          <p>
            The pattern is far weaker than the picture, so the picture is removed first. A denoising filter{" "}
            <code>F</code> estimates the scene content, and subtracting it leaves the noise residual:
          </p>
          <Formula label="W equals I minus F of I, which is approximately I times K plus xi">
            W = I &minus; F(I) &asymp; I&middot;K + &Xi;
          </Formula>
          <p>
            SensorTrace uses the wavelet-domain adaptive Wiener filter of{" "}
            <Cite to="mihcak1999">Mihcak, Kozintsev and Ramchandran (1999)</Cite> in the form introduced for this
            purpose by <Cite to="lukas2006">Lukas, Fridrich and Goljan (2006)</Cite>: a four-level wavelet transform
            in which each detail coefficient is attenuated according to a local variance estimate. Images are analysed
            in the pixel geometry in which they are stored. Nothing is rotated according to metadata or resampled,
            because the pattern is tied to the exact pixel grid of the sensor.
          </p>
          <p>
            The residual also contains structure that is <em>shared</em> by all cameras of a model, such as traces of
            colour-filter interpolation and the JPEG block grid. Two standard operations suppress the classical kinds
            (<Cite to="chen2008">Chen et al. 2008</Cite>; <Cite to="goljan2009">Goljan et al. 2009</Cite>): row and
            column means are removed on each colour-filter phase, and the spectrum is flattened with a Wiener filter in
            the frequency domain. These operations do not remove the artefacts introduced by modern smartphone
            processing.
          </p>
        </DocSection>

        <DocSection id="fingerprint" title="Step 2: the reference fingerprint">
          <p>
            From <code>N</code> reference images taken with the same sensor, the maximum-likelihood estimate of the
            fingerprint (<Cite to="chen2008">Chen et al. 2008</Cite>) weights each residual by the image intensity
            that produced it:
          </p>
          <Formula label="K hat equals the sum over k of W k times I k, divided by the sum over k of I k squared">
            K&#770; = &Sigma;<sub>k</sub> W<sub>k</sub>&middot;I<sub>k</sub> &nbsp;/&nbsp; &Sigma;<sub>k</sub> I<sub>k</sub><sup>2</sup>
          </Formula>
          <p>
            Saturated pixels carry no pattern and are excluded. Under the model, the uncertainty of the estimate falls
            in proportion to <code>1/N</code> and with image brightness. That is why bright, unsaturated, featureless
            reference images work best, and why ordinary photographs need roughly twice as many images as flat ones.
          </p>
          <p>
            Before estimation the reference set is screened. Exact duplicates, unreadable files, digitally zoomed
            images, heavily clipped images and images whose dimensions, make, model or lens differ from the main group
            are rejected with a stated reason. A leave-one-out check then removes images that do not agree with the
            fingerprint built from all the others. Each fingerprint is stored with its diagnostics, including the{" "}
            <strong>split-half</strong> statistic between fingerprints estimated from two disjoint halves of the set,
            which indicates how well determined the fingerprint is.
          </p>
          <p>
            A fingerprint represents one sensor in one capture configuration. Other lenses, resolutions, aspect ratios
            or modes of the same device need their own.
          </p>
        </DocSection>

        <DocSection id="statistic" title="Step 3: the detection statistic">
          <p>
            For a questioned image, the residual <code>W</code> is cross-correlated with the pattern the fingerprint
            predicts for that image, <code>I&middot;K&#770;</code>. If the image came from the sensor, the correlation
            has a single sharp peak at the correct alignment; if not, the correlation surface is flat noise. The{" "}
            <strong>peak-to-correlation energy (PCE)</strong> of{" "}
            <Cite to="goljan2009">Goljan, Fridrich and Filler (2009)</Cite> measures how far the value at the tested
            alignment stands above the rest of the surface:
          </p>
          <Formula label="PCE equals the sign of C at s zero, times C at s zero squared, divided by the mean of C of s squared over all shifts s outside a small neighbourhood of s zero">
            PCE = sign(C(s<sub>0</sub>)) &middot; C(s<sub>0</sub>)<sup>2</sup> &nbsp;/&nbsp; mean<sub>s &notin; N</sub> C(s)<sup>2</sup>
          </Formula>
          <p>
            <code>C(s)</code> is the correlation at shift <code>s</code>, <code>s<sub>0</sub></code> the tested
            alignment, and <code>N</code> a small neighbourhood around it that is left out of the background. The sign
            is kept: a strong negative correlation is not evidence of a match. PCE is a dimensionless statistic on an
            open scale. <strong>It is not a percentage, a probability or a confidence level.</strong>
          </p>
          <p>
            For an image with the same pixel dimensions as the fingerprint, only zero shift is tested, at 0 and 180
            degrees. Searching the whole surface for its maximum when no shift is plausible would turn one test into
            millions and inflate the scores of unrelated sensors. Crops are searched over every placement inside the
            fingerprint, which is experimental. Resized or digitally zoomed images are not registered and will not
            match.
          </p>
        </DocSection>

        <DocSection id="multiple-testing" title="Adjusting for the number of tests">
          <p>
            Every additional hypothesis tested (a rotation, a crop placement, another candidate sensor) is another
            chance for an unrelated sensor to score high by accident. SensorTrace converts the measured statistic to
            an <strong>equivalent single-test value</strong>, shown as the adjusted statistic, and applies the
            thresholds to that. For large values the adjustment is close to subtracting twice the natural logarithm
            of the number of tests.
          </p>
          <p>
            The Gaussian tail figures stored with each measurement are reference values under an idealised noise
            model. Real images have heavier tails, so these figures are never presented as error rates.
          </p>
        </DocSection>

        <DocSection id="decision" title="Decision policy">
          <p>Each comparison ends in one of four outcomes:</p>
          <dl className="not-prose divide-y overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
            {OUTCOMES.map((o) => (
              <div key={o.verdict} className="grid gap-2 p-4 sm:grid-cols-[15rem_1fr] sm:gap-6">
                <dt>
                  <VerdictBadge verdict={o.verdict} wrap />
                </dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{o.meaning}</dd>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Poor quality can hide a match but cannot create one.</strong> Quality checks restrict non-match
              conclusions, never match conclusions.
            </li>
            <li>
              <strong>Open set.</strong> Every candidate is judged on its own. If several sensors exceed the match line
              for one image, the summary says that no single source should be concluded.
            </li>
            <li>
              <strong>Thresholds state their provenance.</strong> The default policy is <em>uncalibrated</em>: it uses
              a PCE of 60 as the match line and 10 as the non-match line. These are reference lines with no error rate
              available. The value 60 is the convention of <Cite to="goljan2009">Goljan et al. (2009)</Cite>, whose
              measured false-alarm rate applied to cameras of that period at full resolution and does not transfer to
              other devices. The non-match line is an engineering choice, not a published figure.
            </li>
            <li>
              <strong>Calibrated policies</strong> record the dataset, the number of trials, the target error rates
              and the device models they cover, and are valid only within that scope.
            </li>
          </ul>
        </DocSection>

        <DocSection id="same-model" title="The same-model alternative">
          <p>
            The classical clean-up steps were designed for cameras that record one exposure and process it lightly.
            Many smartphones released since about 2018 combine several frames, correct lens distortion, apply HDR
            tone mapping and synthesise background blur. This processing can add structure that is common to every
            unit of a model. <Cite to="iuliani2021">Iuliani, Fontani and Piva (2021)</Cite> showed that, as a result,
            different devices of the same model can exceed the conventional threshold, in some cases often.
            A recent preprint by <Cite to="loison2026">Loison et al. (2026)</Cite> examined 30 current flagship
            phones and found that the standard statistic separates same-device comparisons from same-model
            comparisons poorly, which it attributes to a component shared by all fingerprints of one model and
            software version. It proposes subtracting the mean statistic of other same-model devices
            (Delta-sPCE), and its authors state that this is not yet suitable for operational use. SensorTrace shows
            that value as experimental information when control devices exist and never uses it to decide an outcome.
          </p>
          <p>
            SensorTrace therefore records a processing pipeline for each device: <strong>conventional</strong>,{" "}
            <strong>computational</strong> or <strong>unknown</strong> (treated as computational). For a device that
            is not declared conventional, a statistic above the match line supports a match only if one of these holds:
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>the active policy has been calibrated with same-model negatives for that device model; or</li>
            <li>
              at least one <strong>other physical device of the same make and model</strong> was enrolled and compared
              with the same image, and every such control stayed below the match line.
            </li>
          </ol>
          <p>
            Otherwise the outcome is inconclusive and the result suggests enrolling a second device of the same make
            and model as a control. Control-based support is itself labelled experimental: a small control set cannot
            rule out artefacts shared with other units, production batches or software versions.
          </p>
        </DocSection>

        <DocSection id="limitations" title="Limitations">
          <p>
            The following statements are published by the analysis engine of this server and apply to every result.
          </p>
          <div className="not-prose">
            <LimitationsList />
          </div>
          <p>In addition:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Electronic stabilisation and lens-distortion correction warp the image geometry. This is not corrected.</li>
            <li>Dark regions carry little of the pattern and clipped regions none, because PRNU scales with light.</li>
            <li>Strongly textured scenes leak into the residual and lower the statistic.</li>
            <li>Screenshots, edited images and AI-modified images may contain no pattern, or a displaced or partly replaced one. Such changes are flagged only where the file reveals them.</li>
            <li>Video is not supported.</li>
            <li>
              SensorTrace does not report a probability of origin or a likelihood ratio, does not claim an error rate
              outside a validated scope, and is not certified or accredited. Nothing here is a claim that its output
              is admissible as evidence.
            </li>
          </ul>
        </DocSection>

        <DocSection id="evaluation" title="Evaluation data">
          <p>
            The engine&apos;s evaluation framework uses a subset of the <strong>VISION</strong> dataset of{" "}
            <Cite to="shullani2017">Shullani et al. (2017)</Cite>, a public collection of images and videos from
            35 portable devices of 11 brands that includes both original files and versions shared through social
            platforms. Results obtained on one dataset describe the devices and conditions in that dataset. They are
            not error rates for a different camera, and a policy calibrated on them is valid only for the models and
            conditions it records.
          </p>
          <p>
            The synthetic demo data in the app follows the textbook signal model without real camera processing. It
            exists to demonstrate the workflow and says nothing about real-world accuracy.
          </p>
        </DocSection>

        <DocSection id="references" title="References">
          <ol className="not-prose flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            {REFERENCES.map((r, i) => (
              <li key={r.id} id={`ref-${r.id}`} className="flex scroll-mt-24 gap-3 rounded-md target:bg-brand-subtle">
                <span className="font-mono text-xs leading-6 text-foreground">[{i + 1}]</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ol>
          <p>
            For guidance on applying the method, see the <Link href="/docs">documentation</Link>.
          </p>
        </DocSection>
      </DocLayout>
    </>
  );
}
