// Drawn signature → SVG (V1.5 phase A, FL129 "prepared by / received by", not a certification: D16). The screen (a later,
// device phase) collects finger strokes as point lists; this turns them into one small, self-contained SVG that the PDF
// report draws inline. PURE: numbers only go into the markup (no text from the user), so nothing needs escaping.
export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = readonly SignaturePoint[];

export type SignatureSvg = { svg: string; width: number; height: number; strokes: number; points: number };

/** Caps for what a finger can produce in a few seconds; more is a bug or hostile input and is cut, not drawn. */
export const SIGNATURE_LIMITS = { maxStrokes: 200, maxPoints: 5000, maxSide: 4000 } as const;

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/**
 * Strokes (in screen points, any origin) → an SVG whose viewBox hugs the ink plus `padding`. Each stroke is smoothed
 * with quadratic curves through the midpoints of its segments; a single tap becomes a dot. Non-finite points are
 * dropped; null when no ink is left (an empty signature is no signature).
 */
export function signatureSvg(strokes: readonly SignatureStroke[], opts: { strokeWidth?: number; color?: string; padding?: number } = {}): SignatureSvg | null {
  const strokeWidth = opts.strokeWidth ?? 2.5;
  const padding = opts.padding ?? strokeWidth * 2;
  const color = opts.color !== undefined && /^#[0-9a-fA-F]{3,8}$/.test(opts.color) ? opts.color : '#111111';
  const clean: SignaturePoint[][] = [];
  let points = 0;
  for (const s of strokes.slice(0, SIGNATURE_LIMITS.maxStrokes)) {
    const pts = (Array.isArray(s) ? s : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6);
    const room = SIGNATURE_LIMITS.maxPoints - points;
    if (room <= 0) break;
    const kept = pts.slice(0, room);
    if (kept.length > 0) {
      clean.push(kept);
      points += kept.length;
    }
  }
  if (clean.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of clean)
    for (const p of s) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  // scale down (never up) so the longer side fits SIGNATURE_LIMITS.maxSide
  const scale = Math.min(1, SIGNATURE_LIMITS.maxSide / Math.max(maxX - minX, maxY - minY, 1e-9));
  const X = (x: number) => r1((x - minX) * scale + padding);
  const Y = (y: number) => r1((y - minY) * scale + padding);
  const width = Math.max(1, Math.round((maxX - minX) * scale + 2 * padding));
  const height = Math.max(1, Math.round((maxY - minY) * scale + 2 * padding));
  const paths = clean.map((s) => {
    if (s.length === 1) return `M${X(s[0].x)} ${Y(s[0].y)}l0.01 0`;
    if (s.length === 2) return `M${X(s[0].x)} ${Y(s[0].y)}L${X(s[1].x)} ${Y(s[1].y)}`;
    let d = `M${X(s[0].x)} ${Y(s[0].y)}`;
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i].x + s[i + 1].x) / 2;
      const my = (s[i].y + s[i + 1].y) / 2;
      d += `Q${X(s[i].x)} ${Y(s[i].y)} ${X(mx)} ${Y(my)}`;
    }
    const last = s[s.length - 1];
    return `${d}L${X(last.x)} ${Y(last.y)}`;
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<path d="${paths.join('')}" fill="none" stroke="${color}" stroke-width="${r1(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return { svg, width, height, strokes: clean.length, points };
}

/** The SVG as a data URI (for an <img> or a file); base64 so no character of the markup needs URL escaping. */
export function svgDataUri(svg: string): string {
  const b64 = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

/** Only markup made by `signatureSvg` is drawn in a report (a stored or restored signature could be anything). */
export const SIGNATURE_SVG = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="\d+" height="\d+"><path d="[MLQl0-9. -]*" fill="none" stroke="#[0-9a-fA-F]{3,8}" stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"\/><\/svg>$/;
