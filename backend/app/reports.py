"""PDF forensic reports (ReportLab). Every figure in a report comes from stored results."""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
RULE = colors.HexColor("#D1D5DB")
PANEL = colors.HexColor("#F3F4F6")
VERDICT_COLOURS = {
    "match_supported": colors.HexColor("#047857"),
    "non_match_supported": colors.HexColor("#B91C1C"),
    "inconclusive": colors.HexColor("#B45309"),
    "insufficient_or_unsupported": colors.HexColor("#4B5563"),
}
VERDICT_LABELS = {
    "match_supported": "Evidence supports a match",
    "non_match_supported": "Evidence supports a non-match",
    "inconclusive": "Inconclusive",
    "insufficient_or_unsupported": "Insufficient quality or unsupported analysis",
}

DISCLAIMER = (
    "This report was produced by software and has not been reviewed by a certified examiner. "
    "It makes no claim of forensic certification or courtroom admissibility."
)

METHOD_TEXT = [
    "Every digital image sensor has small pixel-to-pixel differences in light sensitivity, known as "
    "photo-response non-uniformity (PRNU). The differences form a faint multiplicative noise pattern "
    "that is present in every image the sensor captures.",
    "<b>Reference fingerprint.</b> For each reference image the scene content is removed with a "
    "wavelet-domain adaptive Wiener denoising filter (Mihcak et al. 1999; Lukas, Fridrich and Goljan "
    "2006), leaving a noise residual. Residuals are combined with the maximum-likelihood estimator of "
    "Chen, Fridrich, Goljan and Lukas (2008). Row and column means are removed on each colour-filter "
    "phase and the spectrum is flattened to suppress artefacts shared by cameras of the same model.",
    "<b>Comparison.</b> The questioned image's residual is correlated with the fingerprint modulated "
    "by the image intensity. The reported statistic is the signed peak-to-correlation energy (PCE; "
    "Goljan, Fridrich and Filler 2009): the squared correlation at the tested alignment divided by "
    "the average squared correlation at wrong alignments, excluding an 11 x 11 neighbourhood of the "
    "peak. When several alignments or candidate sensors are tested, the statistic is adjusted to an "
    "equivalent single-test value.",
    "<b>Decision.</b> The adjusted statistic is compared with the thresholds of the decision policy "
    "stated in this report. Poor image quality can hide a match but cannot create one, so quality "
    "conditions restrict non-match conclusions only. For devices not declared to have a conventional "
    "processing pipeline, a match is supported only when the same-model alternative has been "
    "addressed by calibration or by control devices.",
]

LIMITATIONS = [
    "The result is a statistical indication. It is not proof of origin and not a probability that the image came from the sensor.",
    "The method compares an image with enrolled sensors only. It cannot identify an unknown camera from a single image.",
    "Devices of the same model can share processing artefacts that raise the statistic between different devices, "
    "especially smartphones released since about 2018 (Iuliani et al. 2021; Loison et al. 2026).",
    "Resizing, cropping, digital zoom, stabilisation, multi-frame or HDR capture, portrait rendering, heavy compression, "
    "editing and AI modification can weaken, displace or remove the sensor pattern. A low statistic does not exclude a sensor.",
    "A fingerprint represents one sensor in one capture configuration. Other lenses, resolutions or modes of the same device require their own fingerprints.",
    "Thresholds marked uncalibrated carry no measured error rate. Calibrated thresholds apply only to the device models "
    "and image conditions of the validation data they were derived from.",
    "Idealised-model figures (Gaussian tail values) are reference numbers under textbook assumptions that real images violate. They are not error rates.",
]


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    base.fontName, base.fontSize, base.leading, base.textColor = (
        "Helvetica",
        9,
        12.5,
        INK,
    )

    def mk(name: str, **kw: Any) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base, **kw)

    return {
        "body": base,
        "small": mk("small", fontSize=7.5, leading=10, textColor=MUTED),
        "mono": mk("mono", fontName="Courier", fontSize=7.5, leading=10),
        "title": mk("title", fontName="Helvetica-Bold", fontSize=18, leading=22, spaceAfter=2),
        "subtitle": mk("subtitle", fontSize=10, leading=13, textColor=MUTED),
        "h1": mk(
            "h1",
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            spaceBefore=12,
            spaceAfter=5,
        ),
        "h2": mk(
            "h2",
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=12,
            spaceBefore=7,
            spaceAfter=3,
        ),
        "cell": mk("cell", fontSize=8, leading=10.5, alignment=TA_LEFT),
        "cellb": mk("cellb", fontName="Helvetica-Bold", fontSize=8, leading=10.5),
        "verdict": mk(
            "verdict",
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.white,
        ),
    }


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape("" if text is None else str(text)), style)


def _num(v: Any, fmt: str = "{:,.2f}") -> str:
    if v is None:
        return "n/a"
    try:
        return fmt.format(v)
    except (ValueError, TypeError):
        return str(v)


def _sci(v: Any) -> str:
    return "n/a" if v is None else f"{v:.3g}"


def _kv(
    rows: list[tuple[str, Any]],
    st: dict[str, ParagraphStyle],
    widths: tuple[float, float] = (45 * mm, 125 * mm),
    mono: set[str] | None = None,
) -> Table:
    mono = mono or set()
    data = [[_p(k, st["cellb"]), _p(v, st["mono"] if k in mono else st["cell"])] for k, v in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))  # fmt: skip
    return t


def _grid(
    header: list[str],
    rows: list[list[Any]],
    widths: list[float],
    st: dict[str, ParagraphStyle],
) -> Table:
    data = [[_p(h, st["cellb"]) for h in header]] + [[c if isinstance(c, Paragraph) else _p(c, st["cell"]) for c in r] for r in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PANEL), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE), ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 3),
    ]))  # fmt: skip
    return t


def _banner(text: str, colour: colors.Color, st: dict[str, ParagraphStyle]) -> Table:
    t = Table([[_p(text, st["verdict"])]], colWidths=[170 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colour), ("TOPPADDING", (0, 0), (-1, -1), 6),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 8)]))  # fmt: skip
    return t


def surface_png(window: list[list[float]], scale: int = 10) -> bytes:
    """Heat-map of the correlation-surface window (values in off-peak standard deviations)."""
    a = np.asarray(window, dtype=np.float64)
    lim = max(float(np.abs(a).max()), 4.0)
    v = np.clip(a / lim, -1, 1)
    rgb = np.empty((*a.shape, 3), dtype=np.float64)
    # diverging map: blue (negative) - near-white (zero) - dark red (positive)
    pos, neg = np.clip(v, 0, 1), np.clip(-v, 0, 1)
    rgb[..., 0] = 245 - 185 * neg - 95 * pos
    rgb[..., 1] = 245 - 150 * neg - 215 * pos
    rgb[..., 2] = 245 - 60 * neg - 210 * pos
    img = PILImage.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((a.shape[1] * scale, a.shape[0] * scale), PILImage.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _img(data: bytes | None, max_w: float, max_h: float) -> Image | None:
    if not data:
        return None
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            w, h = im.size
    except Exception:
        return None
    k = min(max_w / w, max_h / h)
    return Image(io.BytesIO(data), width=w * k, height=h * k)


def _page(report_id: str, demo: bool):
    def draw(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 11 * mm, f"SensorTrace report {report_id}")
        canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page}")
        canvas.drawString(
            20 * mm,
            7.5 * mm,
            "Statistical indication only. Not a certified forensic report.",
        )
        if demo:
            canvas.setFont("Helvetica-Bold", 44)
            canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.12))
            canvas.translate(105 * mm, 150 * mm)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "SYNTHETIC DEMO DATA")
        canvas.restoreState()

    return draw


def _fmt_dt(v: Any) -> str:
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(v or "n/a")


def _evidence_rows(ev: dict[str, Any]) -> list[tuple[str, Any]]:
    md = ev.get("image_metadata") or {}
    acq = ev.get("acquisition") or {}
    rows: list[tuple[str, Any]] = [
        ("Evidence ID", ev["id"]), ("Filename", ev["filename"]), ("SHA-256", ev["sha256"]),
        ("Size", f"{ev['size_bytes']:,} bytes"), ("Format", ev["mime_type"]),
        ("Dimensions (stored)", f"{ev['width']} x {ev['height']} px"),
        ("EXIF orientation", (ev.get("provenance") or {}).get("exif_orientation", "n/a")),
        ("Received", _fmt_dt(ev.get("created_at"))),
    ]  # fmt: skip
    cam = " ".join(str(md[k]) for k in ("Make", "Model") if md.get(k))
    rows.append(("Camera in metadata", cam or "none recorded"))
    for label, key in (("Software", "Software"), ("Captured", "DateTimeOriginal"), ("Lens", "LensModel"),
                       ("JPEG quality (est.)", "JpegQualityEstimate"), ("Digital zoom ratio", "DigitalZoomRatio")):  # fmt: skip
        if md.get(key) not in (None, ""):
            v = md[key]
            rows.append((label, f"{v:.0f}" if key == "JpegQualityEstimate" else v))
    for label, key in (("Acquisition source", "source"), ("Acquired at", "acquired_at"), ("Acquired by", "acquired_by"),
                       ("Acquisition method", "method"), ("Acquisition notes", "notes")):  # fmt: skip
        if acq.get(key):
            rows.append((label, acq[key]))
    return rows


def build_analysis_report(*, report_id: str, generated_at: datetime, generated_by: str, analysis: dict[str, Any],
                          evidence: dict[str, Any], candidates: list[dict[str, Any]], investigation: dict[str, Any] | None,
                          preview: bytes | None, residual_visual: bytes | None, demo: bool = False) -> bytes:  # fmt: skip
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"SensorTrace report {report_id}", author="SensorTrace", subject="Image source comparison")  # fmt: skip
    el: list[Any] = []
    policy = analysis.get("policy") or {}
    prov = analysis.get("provenance") or {}
    summary = analysis.get("summary") or {}

    el += [_p("Image source comparison report", st["title"]),
           _p("Sensor pattern noise (PRNU) analysis of a questioned image against enrolled sensor fingerprints", st["subtitle"]),
           Spacer(1, 6)]  # fmt: skip
    if demo:
        el += [
            _banner(
                "SYNTHETIC DEMONSTRATION DATA - not real evidence; results say nothing about real-world accuracy",
                colors.HexColor("#B91C1C"),
                st,
            ),
            Spacer(1, 6),
        ]
    head = [("Report ID", report_id), ("Generated", _fmt_dt(generated_at)), ("Generated by", generated_by),
            ("Analysis ID", analysis["id"]), ("Analysis completed", _fmt_dt(analysis.get("completed_at")))]  # fmt: skip
    if investigation:
        head += [
            (
                "Investigation",
                f"{investigation['title']}" + (f" (ref. {investigation['reference']})" if investigation.get("reference") else ""),
            )
        ]
    el += [
        _kv(head, st, mono={"Report ID", "Analysis ID"}),
        Spacer(1, 4),
        _p(DISCLAIMER, st["small"]),
    ]

    # 1 ---------------------------------------------------------------- summary
    el.append(_p("1. Summary of findings", st["h1"]))
    el.append(_p(summary.get("text", ""), st["body"]))
    el.append(Spacer(1, 5))
    rows = []
    for c in candidates:
        snap = c["snapshot"]
        vp = Paragraph(
            f'<font color="{VERDICT_COLOURS.get(c["verdict"], INK).hexval()}"><b>{escape(VERDICT_LABELS.get(c["verdict"], c["verdict"]))}</b></font>',
            st["cell"],
        )
        rows.append(
            [
                c["rank"],
                f"{snap.get('device_name', '')} / {snap.get('sensor_name', '')}",
                _num(c.get("pce")),
                _num(c.get("effective_pce")),
                _num(c.get("ncc"), "{:.5f}"),
                vp,
            ]
        )
    el.append(
        _grid(
            ["#", "Sensor", "PCE", "Adjusted statistic", "NCC", "Outcome"],
            rows,
            [8 * mm, 52 * mm, 24 * mm, 28 * mm, 20 * mm, 38 * mm],
            st,
        )
    )
    el.append(Spacer(1, 4))
    th = f"Match threshold {policy.get('match_threshold', 'n/a')}; non-match threshold {policy.get('non_match_threshold', 'n/a')}; policy '{policy.get('policy_id', 'n/a')}' ({'calibrated' if policy.get('calibrated') else 'UNCALIBRATED reference lines - no error rate available'})."
    el.append(_p(th, st["small"]))
    el.append(
        _p(
            "Outcomes are statistical indications under the stated policy. See sections 6 and 7 for interpretation and limitations.",
            st["small"],
        )
    )

    # 2 ------------------------------------------------------- questioned image
    el.append(_p("2. Questioned image", st["h1"]))
    info = _kv(
        _evidence_rows(evidence),
        st,
        widths=(38 * mm, 82 * mm),
        mono={"SHA-256", "Evidence ID"},
    )
    thumb = _img(preview, 46 * mm, 46 * mm)
    if thumb is not None:
        side = Table(
            [
                [thumb],
                [
                    _p(
                        "Reduced preview for identification only. Analysis used the original file bytes.",
                        st["small"],
                    )
                ],
            ],
            colWidths=[48 * mm],
        )
        el.append(
            Table(
                [[info, side]],
                colWidths=[122 * mm, 48 * mm],
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ]
                ),
            )
        )
    else:
        el.append(info)
    q = analysis.get("quality") or {}
    metrics = q.get("metrics") or {}
    el.append(_p("Image quality and processing indicators", st["h2"]))
    el.append(_kv([
        ("Resolution", f"{_num(metrics.get('megapixels'))} MP"), ("Mean intensity (0-255)", _num(metrics.get("mean_intensity"))),
        ("Clipped pixels", _num((metrics.get("saturated_fraction") or 0) * 100) + " %"),
        ("Dark pixels", _num((metrics.get("dark_fraction") or 0) * 100) + " %"), ("Texture index", _num(metrics.get("texture_index"))),
    ], st))  # fmt: skip
    flags = q.get("flags") or []
    if flags:
        el.append(Spacer(1, 3))
        el.append(
            _grid(
                ["Severity", "Condition"],
                [[f["severity"], f["message"]] for f in flags],
                [22 * mm, 148 * mm],
                st,
            )
        )
    else:
        el.append(_p("No quality or processing conditions were flagged.", st["body"]))

    # 3 ------------------------------------------------------ reference sensors
    el.append(_p("3. Reference sensors compared", st["h1"]))
    for c in candidates:
        snap = c["snapshot"]
        block = [_p(f"Candidate {c['rank']}: {snap.get('device_name', '')} / {snap.get('sensor_name', '')}", st["h2"]),
                 _kv([
                     ("Make / model", f"{snap.get('make') or 'n/a'} / {snap.get('model') or 'n/a'}"),
                     ("Serial number", snap.get("serial_number") or "not recorded"), ("Firmware", snap.get("firmware") or "not recorded"),
                     ("Processing pipeline", snap.get("pipeline_class")), ("Fingerprint version", snap.get("fingerprint_version")),
                     ("Fingerprint digest", snap.get("fingerprint_digest")),
                     ("Fingerprint size", f"{snap.get('fingerprint_width')} x {snap.get('fingerprint_height')} px"),
                     ("Reference images used", snap.get("n_images")), ("Split-half consistency (PCE)", _num(snap.get("split_half_pce"))),
                     ("Algorithm version", snap.get("algorithm_version")),
                 ], st, mono={"Fingerprint digest"})]  # fmt: skip
        el.append(KeepTogether(block))

    # 4 ----------------------------------------------------------------- results
    el.append(PageBreak())
    el.append(_p("4. Measurements and outcome for each candidate", st["h1"]))
    for c in candidates:
        snap, mm_, dec = (
            c["snapshot"],
            c.get("measurement") or {},
            c.get("decision") or {},
        )
        el.append(
            _p(
                f"Candidate {c['rank']}: {snap.get('device_name', '')} / {snap.get('sensor_name', '')}",
                st["h2"],
            )
        )
        el.append(
            _banner(
                VERDICT_LABELS.get(c["verdict"], c["verdict"]),
                VERDICT_COLOURS.get(c["verdict"], INK),
                st,
            )
        )
        el.append(Spacer(1, 3))
        rows2: list[tuple[str, Any]] = [
            ("Geometry", mm_.get("geometry")), ("Signed PCE", _num(mm_.get("pce"), "{:,.3f}")),
            ("Adjusted statistic", _num(dec.get("effective_pce"), "{:,.3f}")),
            ("Normalised correlation", _num(mm_.get("ncc"), "{:.6f}")),
            ("Alignments tested", f"{mm_.get('search_size', 0):,}"), ("Rotation at best alignment", f"{mm_.get('rotation')} degrees"),
            ("Offset in fingerprint grid", str(mm_.get("shift"))),
            ("Pixels used", f"{mm_.get('valid_pixels', 0):,} ({(mm_.get('valid_fraction') or 0) * 100:.1f} %)"),
            ("Statistic by rotation", ", ".join(f"{k}: {v:,.2f}" for k, v in (mm_.get("tested") or {}).items()) or "n/a"),
            ("Idealised-model tail, single test", _sci(mm_.get("p_value_gaussian"))),
            ("Idealised-model tail, all alignments", _sci(mm_.get("p_false_alarm_gaussian"))),
        ]  # fmt: skip
        exp = c.get("experimental")
        if exp and exp.get("delta_spce") is not None:
            rows2.append(
                (
                    "Delta-sPCE (experimental)",
                    f"{exp['delta_spce']:,.2f} against {len(exp.get('control_ids') or [])} same-model control(s); not used for the outcome",
                )
            )
        nua = dec.get("nua") or {}
        rows2.append(("Same-model alternative", {
            "declared_conventional": "Not applied: device declared to have a conventional pipeline",
            "calibrated_for_model": "Addressed by calibration for this model",
            "same_model_controls": f"Addressed by {nua.get('n_controls')} control device(s); highest control {_num(nua.get('max_control'))}",
            "controls_failed": f"NOT resolved: a control device also exceeded the threshold ({_num(nua.get('max_control'))})",
            "none": "NOT addressed: no calibration or control devices for this model",
        }.get(nua.get("mitigation", ""), "Not applicable to this outcome")))  # fmt: skip
        el.append(_kv(rows2, st))
        el.append(
            _p(
                "Idealised-model figures assume independent Gaussian noise, which real images violate. They are reference values, not error rates.",
                st["small"],
            )
        )
        if dec.get("reasons"):
            el.append(_p("Basis for the outcome", st["h2"]))
            for r in dec["reasons"]:
                el.append(_p(f"- {r}", st["body"]))
        if mm_.get("notes"):
            for n in mm_["notes"]:
                el.append(_p(f"- {n}", st["body"]))
        sw = mm_.get("surface_window")
        if sw:
            fig = _img(surface_png(sw), 60 * mm, 60 * mm)
            cap = _p("Correlation surface around the tested alignment (33 x 33 shifts), in units of the off-peak standard deviation. "
                     "Red is positive, blue negative. A same-sensor image shows one isolated strong peak at the centre.", st["small"])  # fmt: skip
            el.append(Spacer(1, 4))
            el.append(
                KeepTogether(
                    [
                        Table(
                            [[fig, cap]],
                            colWidths=[64 * mm, 106 * mm],
                            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]),
                        )
                    ]
                )
            )
        el.append(Spacer(1, 8))

    rv = _img(residual_visual, 80 * mm, 80 * mm)
    if rv is not None:
        el.append(KeepTogether([_p("Noise residual of the questioned image", st["h2"]), rv,
                                _p("Contrast-enhanced visualisation, stretched to +/-3 standard deviations and possibly cropped. "
                                   "It is not the numerical data used for matching.", st["small"])]))  # fmt: skip

    # 5 ------------------------------------------------------------------ policy
    el.append(_p("5. Decision policy and calibration", st["h1"]))
    el.append(_kv([("Policy", policy.get("policy_id")), ("Calibrated", "Yes" if policy.get("calibrated") else "No"),
                   ("Match threshold", policy.get("match_threshold")), ("Non-match threshold", policy.get("non_match_threshold")),
                   ("Minimum usable pixels", f"{policy.get('min_valid_pixels', 0):,}"),
                   ("Reference images required for non-match", policy.get("min_reference_images_for_non_match")),
                   ("Basis", policy.get("basis"))], st))  # fmt: skip
    cal = policy.get("calibration")
    if policy.get("calibrated") and cal:
        op = cal.get("held_out_test_operating_point") or {}
        el.append(_p("Calibration data", st["h2"]))
        el.append(_kv([
            ("Dataset", cal.get("dataset")), ("Attribution", cal.get("attribution")), ("Models covered", ", ".join(cal.get("model_keys") or []) or "none"),
            ("Calibration trials", f"{cal.get('n_same')} same-device; {cal.get('n_same_model_diff')} same-model different-device; {cal.get('n_different_model_diff')} different-model"),
            ("Targets", f"false-positive rate {cal.get('target_fpr')}, miss rate {cal.get('target_fnr')}"),
            ("Held-out test result", (f"{op.get('false_positives')}/{op.get('n_diff')} false matches (95% CI {op.get('fpr_ci', ['?', '?'])[0]:.4f}-{op.get('fpr_ci', ['?', '?'])[1]:.4f}); "
                                      f"{op.get('false_negatives')}/{op.get('n_same')} misses (95% CI {op.get('fnr_ci', ['?', '?'])[0]:.4f}-{op.get('fnr_ci', ['?', '?'])[1]:.4f})") if op else "n/a"),
        ], st))  # fmt: skip
        el.append(
            _p(
                "These rates were observed on the named dataset only. They do not transfer to other device models, firmware, capture modes or processing.",
                st["small"],
            )
        )
    else:
        el.append(
            _p(
                "No calibration applies. The thresholds are reference lines from the literature and no false-match or missed-match rate is available for this comparison.",
                st["body"],
            )
        )

    # 6, 7, 8 ------------------------------------------------------------- text
    el.append(_p("6. Interpretation", st["h1"]))
    seen: list[str] = []
    for c in candidates:
        for cav in (c.get("decision") or {}).get("caveats") or []:
            if cav not in seen:
                seen.append(cav)
    for cav in seen:
        el.append(_p(f"- {cav}", st["body"]))
    el.append(_p("7. Limitations", st["h1"]))
    for lim in LIMITATIONS:
        el.append(_p(f"- {lim}", st["body"]))
    el.append(_p("8. Methodology", st["h1"]))
    for para in METHOD_TEXT:
        el.append(Paragraph(para, st["body"]))
        el.append(Spacer(1, 3))
    el.append(_p("9. Reproducibility", st["h1"]))
    libs = prov.get("libraries") or {}
    el.append(_kv([
        ("Algorithm version", prov.get("algorithm_version")), ("Engine version", prov.get("engine_version")),
        ("Decision logic version", policy.get("version")), ("Denoising parameter sigma0", prov.get("sigma0")),
        ("Libraries", ", ".join(f"{k} {v}" for k, v in libs.items())), ("Questioned image SHA-256", evidence["sha256"]),
        ("Fingerprint digests", "; ".join(f"#{c['rank']}: {c['snapshot'].get('fingerprint_digest')}" for c in candidates)),
    ], st, mono={"Questioned image SHA-256", "Fingerprint digests"}))  # fmt: skip
    el.append(Spacer(1, 4))
    el.append(_p("Re-running the same algorithm version on the same file bytes and fingerprints reproduces these measurements. "
                 "Pixel decoding depends on the listed library versions.", st["small"]))  # fmt: skip

    doc.build(el, onFirstPage=_page(report_id, demo), onLaterPages=_page(report_id, demo))
    return buf.getvalue()


def build_investigation_report(*, report_id: str, generated_at: datetime, generated_by: str, investigation: dict[str, Any],
                               evidence: list[dict[str, Any]], analyses: list[dict[str, Any]], notes: list[dict[str, Any]],
                               history: list[dict[str, Any]], demo: bool = False) -> bytes:  # fmt: skip
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"SensorTrace investigation report {report_id}", author="SensorTrace")  # fmt: skip
    el: list[Any] = [
        _p("Investigation summary report", st["title"]),
        _p(investigation["title"], st["subtitle"]),
        Spacer(1, 6),
    ]
    if demo:
        el += [
            _banner(
                "SYNTHETIC DEMONSTRATION DATA - not real evidence",
                colors.HexColor("#B91C1C"),
                st,
            ),
            Spacer(1, 6),
        ]
    el.append(_kv([("Report ID", report_id), ("Generated", _fmt_dt(generated_at)), ("Generated by", generated_by),
                   ("Investigation ID", investigation["id"]), ("Reference", investigation.get("reference") or "none"),
                   ("Status", investigation["status"]), ("Created", _fmt_dt(investigation["created_at"])),
                   ("Retention date", _fmt_dt(investigation.get("retention_until")) if investigation.get("retention_until") else "none set"),
                   ("Description", investigation.get("description") or "none")], st, mono={"Report ID", "Investigation ID"}))  # fmt: skip
    el += [Spacer(1, 4), _p(DISCLAIMER, st["small"])]

    el.append(_p(f"1. Evidence ({len(evidence)} items)", st["h1"]))
    if evidence:
        el.append(_grid(["Filename", "Category", "Dimensions", "SHA-256", "Received"],
                        [[e["filename"], e["category"], f"{e['width']}x{e['height']}", Paragraph(escape(e["sha256"]), st["mono"]), _fmt_dt(e["created_at"])] for e in evidence],
                        [42 * mm, 20 * mm, 22 * mm, 58 * mm, 28 * mm], st))  # fmt: skip
    else:
        el.append(_p("No evidence has been added.", st["body"]))

    el.append(_p(f"2. Comparisons ({len(analyses)})", st["h1"]))
    rows = []
    for a in analyses:
        for c in a["candidates"] or [None]:
            if c is None:
                rows.append(
                    [
                        a["evidence_filename"],
                        "n/a",
                        "n/a",
                        a["status"],
                        _fmt_dt(a.get("completed_at")),
                    ]
                )
            else:
                snap = c["snapshot"]
                vp = Paragraph(
                    f'<font color="{VERDICT_COLOURS.get(c["verdict"], INK).hexval()}"><b>{escape(VERDICT_LABELS.get(c["verdict"], c["verdict"]))}</b></font>',
                    st["cell"],
                )
                rows.append(
                    [
                        a["evidence_filename"],
                        f"{snap.get('device_name', '')} / {snap.get('sensor_name', '')}",
                        _num(c.get("effective_pce")),
                        vp,
                        _fmt_dt(a.get("completed_at")),
                    ]
                )
    if rows:
        el.append(
            _grid(
                [
                    "Questioned image",
                    "Sensor",
                    "Adjusted statistic",
                    "Outcome",
                    "Completed",
                ],
                rows,
                [40 * mm, 45 * mm, 25 * mm, 34 * mm, 26 * mm],
                st,
            )
        )
        el.append(Spacer(1, 3))
        el.append(
            _p(
                "Outcomes are statistical indications under each analysis's decision policy; generate the individual comparison report for measurements, policy and limitations.",
                st["small"],
            )
        )
    else:
        el.append(_p("No comparisons have been saved to this investigation.", st["body"]))

    el.append(_p(f"3. Notes ({len(notes)})", st["h1"]))
    for n in notes:
        el.append(_p(_fmt_dt(n["created_at"]), st["small"]))
        for line in str(n["body"]).splitlines() or [""]:
            el.append(_p(line, st["body"]))
        el.append(Spacer(1, 4))
    if not notes:
        el.append(_p("No notes.", st["body"]))

    el.append(_p("4. Processing history", st["h1"]))
    if history:
        el.append(_grid(["Time", "Action", "Item"], [[_fmt_dt(h["created_at"]), h["action"], f"{h['entity_type']} {h['entity_id'][:8]}"] for h in history],
                        [38 * mm, 62 * mm, 70 * mm], st))  # fmt: skip
    el.append(_p("5. Limitations", st["h1"]))
    for lim in LIMITATIONS:
        el.append(_p(f"- {lim}", st["body"]))
    doc.build(el, onFirstPage=_page(report_id, demo), onLaterPages=_page(report_id, demo))
    return buf.getvalue()
