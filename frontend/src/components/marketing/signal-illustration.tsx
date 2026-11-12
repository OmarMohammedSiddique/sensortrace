import { cn } from "@/lib/utils";

/** Small deterministic PRNG so the illustration is identical on server and client. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const NOISE_COLS = 26;
const NOISE_ROWS = 26;
const CELL = 6;

function noiseCells() {
  const rand = mulberry32(20261112);
  const cells: { x: number; y: number; o: number }[] = [];
  for (let r = 0; r < NOISE_ROWS; r++) {
    for (let c = 0; c < NOISE_COLS; c++) {
      const g = Math.max(-2.2, Math.min(2.2, gaussian(rand)));
      cells.push({ x: c * CELL, y: r * CELL, o: Math.round(((g + 2.2) / 4.4) * 62 + 6) / 100 });
    }
  }
  return cells;
}

const RIDGE_ROWS = 23;
const RIDGE_COLS = 56;
const RIDGE_W = 300;
const ROW_GAP = 6.2;
const PEAK_H = 118;

function ridgePaths() {
  const rand = mulberry32(7254);
  const cr = (RIDGE_ROWS - 1) / 2;
  const cc = (RIDGE_COLS - 1) / 2;
  const rows: { d: string; near: number }[] = [];
  for (let r = 0; r < RIDGE_ROWS; r++) {
    const baseY = 150 + r * ROW_GAP;
    const skew = (r - cr) * -1.6;
    let d = "";
    for (let c = 0; c < RIDGE_COLS; c++) {
      const x = 10 + skew + (c / (RIDGE_COLS - 1)) * RIDGE_W;
      const dr = (r - cr) / 0.85;
      const dc = (c - cc) / 1.25;
      const peak = PEAK_H * Math.exp(-0.5 * (dr * dr + dc * dc));
      const y = baseY - peak - gaussian(rand) * 1.35;
      d += `${c === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    rows.push({ d, near: Math.exp(-0.5 * ((r - cr) / 0.85) ** 2) });
  }
  return rows;
}

const CELLS = noiseCells();
const RIDGES = ridgePaths();

/**
 * Decorative hero figure built from the method's two central ideas: a noise residual
 * (left) and a correlation surface with a single sharp peak (right). It is procedurally
 * generated, NOT measured data, and is labelled as an illustration.
 */
export function SignalIllustration({ className }: { className?: string }) {
  return (
    <figure className={cn("relative overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", className)}>
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      <div className="relative flex items-center justify-between border-b px-4 py-2.5">
        <span className="eyebrow">Illustration</span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">not measured data</span>
      </div>
      <svg
        viewBox="0 0 520 318"
        role="img"
        aria-label="Illustration: on the left a square of fine random noise representing the noise residual of a photograph; on the right a mostly flat surface of small ripples with one tall, narrow peak at its centre, representing the correlation with a matching sensor fingerprint."
        className="relative block h-auto w-full"
      >
        {/* Noise residual */}
        <g transform="translate(22 78)" className="text-foreground">
          <rect x="-1" y="-1" width={NOISE_COLS * CELL + 2} height={NOISE_ROWS * CELL + 2} rx="3" fill="none" stroke="currentColor" strokeOpacity="0.14" />
          {CELLS.map((cell, i) => (
            <rect key={i} x={cell.x} y={cell.y} width={CELL - 0.6} height={CELL - 0.6} fill="currentColor" opacity={cell.o} />
          ))}
        </g>
        <text x="22" y="258" className="fill-muted-foreground font-mono text-[9px]">W = I - F(I)</text>
        <text x="22" y="62" className="fill-foreground text-[10.5px] font-medium">Noise residual</text>

        {/* Connector */}
        <g className="text-muted-foreground" stroke="currentColor" strokeOpacity="0.55" fill="none" strokeWidth="1">
          <path d="M184 156h17" strokeDasharray="2 3" />
          <path d="M198 152.5l4 3.5-4 3.5" />
        </g>

        {/* Correlation surface */}
        <text x="214" y="62" className="fill-foreground text-[10.5px] font-medium">Correlation surface</text>
        <g transform="translate(200 12)">
          {RIDGES.map((row, i) => (
            <g key={i}>
              <path d={`${row.d}L330 310L-20 310Z`} className="fill-card" />
              <path
                d={row.d}
                fill="none"
                strokeWidth={row.near > 0.3 ? 1.25 : 0.9}
                strokeLinejoin="round"
                className={row.near > 0.3 ? "stroke-primary" : "stroke-foreground"}
                strokeOpacity={row.near > 0.3 ? 0.55 + row.near * 0.45 : 0.3}
              />
            </g>
          ))}
        </g>
        <g className="text-muted-foreground" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1" fill="none">
          <path d="M392 40h34" />
        </g>
        <text x="430" y="43" className="fill-foreground font-mono text-[9px]">peak</text>
        <text x="214" y="306" className="fill-muted-foreground font-mono text-[9px]">PCE = peak energy / background energy</text>
      </svg>
    </figure>
  );
}
