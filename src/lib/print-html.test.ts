import { PRINT_PROFILE, printHtml } from './print-html';

const HTML = '<html><head><style>x{}</style></head><body>b</body></html>';

describe('print profiles (D75)', () => {
  it('iOS: zoom, hidden top spacer, visible per-calculation note; native top/bottom margins only', () => {
    const out = printHtml(HTML, 'ios', 'A4');
    expect(out).toContain('html{zoom:0.9375}');
    expect(out).toContain('.top-space{display:none}');
    expect(out).toContain('.calc-note{display:block}');
    expect(out).toContain('.foot .resp-note{display:none}');
    expect(out.indexOf('<style>html{zoom')).toBeLessThan(out.indexOf('</head>'));
    expect(PRINT_PROFILE.ios.margins).toEqual({ left: 0, right: 0, top: 31, bottom: 31 });
  });
  it('Android: the document is printed as it is (Chromium measures 1:1 and repeats the footer)', () => {
    expect(printHtml(HTML, 'android', 'Letter')).toBe(HTML);
    expect(PRINT_PROFILE.android.margins).toBeNull();
  });
  it('a zoom override (re-measuring a new OS) replaces the factor', () => {
    expect(printHtml(HTML, 'ios', 'A4', 1)).not.toContain('zoom');
    expect(printHtml(HTML, 'ios', 'A4', 1.1)).toContain('html{zoom:1.1}');
  });
});
