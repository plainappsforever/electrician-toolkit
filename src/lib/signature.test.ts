// Signature SVG builder (V1.5 phase A, FL129).
import { rng } from '../../test/seeded-random';

import { SIGNATURE_LIMITS, SIGNATURE_SVG, signatureSvg, svgDataUri } from './signature';

const numbersIn = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('signatureSvg', () => {
  it('no ink → null (an empty pad is no signature)', () => {
    expect(signatureSvg([])).toBeNull();
    expect(signatureSvg([[], []])).toBeNull();
    expect(signatureSvg([[{ x: NaN, y: 1 }, { x: Infinity, y: 2 }]])).toBeNull();
  });

  it('one stroke: smoothed with quadratic curves, viewBox hugs the ink plus padding, fixed markup', () => {
    const s = signatureSvg([[{ x: 100, y: 50 }, { x: 110, y: 60 }, { x: 130, y: 55 }, { x: 150, y: 70 }]], { strokeWidth: 2, padding: 4 })!;
    expect(s).toMatchObject({ width: 58, height: 28, strokes: 1, points: 4 });
    expect(s.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 28" width="58" height="28"><path d="M4 4Q14 14 24 11.5Q34 9 44 16.5L54 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
    expect(SIGNATURE_SVG.test(s.svg)).toBe(true);
  });

  it('a tap is a dot, two points a line; several strokes in one path; a colour only as #hex', () => {
    const s = signatureSvg([[{ x: 0, y: 0 }], [{ x: 10, y: 0 }, { x: 20, y: 5 }]], { color: '#0033aa' })!;
    expect(s.svg).toContain('d="M5 5l0.01 0M15 5L25 10"');
    expect(s.svg).toContain('stroke="#0033aa"');
    expect(signatureSvg([[{ x: 0, y: 0 }]], { color: 'red" onload="x' })!.svg).toContain('stroke="#111111"');
  });

  it('cuts hostile input: too many strokes or points, huge coordinates are scaled down', () => {
    const many = Array.from({ length: 500 }, (_, i) => [{ x: i, y: i }, { x: i + 1, y: i + 2 }]);
    const s = signatureSvg(many)!;
    expect(s.strokes).toBe(SIGNATURE_LIMITS.maxStrokes);
    const long = [Array.from({ length: 20000 }, (_, i) => ({ x: i, y: Math.sin(i) * 10 }))];
    expect(signatureSvg(long)!.points).toBe(SIGNATURE_LIMITS.maxPoints);
    const huge = signatureSvg([[{ x: 0, y: 0 }, { x: 900000, y: 300000 }]])!;
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxSide + 20);
    expect(signatureSvg([[{ x: 1e9, y: 0 }]])).toBeNull(); // beyond any screen: dropped
  });

  it('property: random finger strokes always give markup the report accepts, every point inside the viewBox (200 runs)', () => {
    const R = rng(20261015);
    for (let run = 0; run < 200; run++) {
      const strokes = Array.from({ length: R.int(1, 8) }, () => {
        let x = R.between(-500, 500);
        let y = R.between(-500, 500);
        return Array.from({ length: R.int(1, 60) }, () => ({ x: (x += R.between(-15, 15)), y: (y += R.between(-15, 15)) }));
      });
      const s = signatureSvg(strokes)!;
      expect(SIGNATURE_SVG.test(s.svg)).toBe(true);
      const d = /d="([^"]*)"/.exec(s.svg)![1];
      const nums = numbersIn(d.replace(/l0\.01 0/g, ''));
      let outside = 0;
      for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i] < 0 || nums[i] > s.width || nums[i + 1] < 0 || nums[i + 1] > s.height) outside++;
      expect([run, outside]).toEqual([run, 0]);
    }
  });

  it('data URI round trip', () => {
    const s = signatureSvg([[{ x: 0, y: 0 }, { x: 5, y: 5 }]])!;
    const uri = svgDataUri(s.svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1], 'base64').toString('utf8')).toBe(s.svg);
  });
});
