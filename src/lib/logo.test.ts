import { MAX_LOGO_BYTES, settingProblem } from '@/db/settings';

import { logoFromBase64 } from './logo';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('logo from a picked file', () => {
  it('accepts a PNG and a JPEG by their bytes, and the result passes the settings validator', () => {
    const png = logoFromBase64(70, PNG);
    expect(png).toEqual({ ok: true, dataUri: `data:image/png;base64,${PNG}` });
    if (png.ok) expect(settingProblem('logoDataUri', png.dataUri)).toBeNull();
    const jpeg = logoFromBase64(3, '/9j/4AAQ');
    expect(jpeg).toEqual({ ok: true, dataUri: 'data:image/jpeg;base64,/9j/4AAQ' });
  });

  it('refuses a file above 512 KB by its size, without needing the content', () => {
    expect(logoFromBase64(MAX_LOGO_BYTES + 1, '')).toEqual({ ok: false, reason: 'tooBig' });
    expect(logoFromBase64(MAX_LOGO_BYTES, PNG).ok).toBe(true);
  });

  it('refuses decoded content above 512 KB even when the size said otherwise', () => {
    const big = 'iVBORw0KGgo' + 'A'.repeat(Math.ceil(((MAX_LOGO_BYTES + 100) * 4) / 3));
    expect(logoFromBase64(10, big)).toEqual({ ok: false, reason: 'tooBig' });
  });

  it('refuses anything that is not a PNG or JPEG: GIF, text, PDF, a renamed file, bad base64', () => {
    expect(logoFromBase64(10, 'R0lGODlhAQABAAAAACw=')).toEqual({ ok: false, reason: 'notImage' }); // GIF
    expect(logoFromBase64(10, 'SGVsbG8gd29ybGQ=')).toEqual({ ok: false, reason: 'notImage' });
    expect(logoFromBase64(10, 'JVBERi0xLjQK')).toEqual({ ok: false, reason: 'notImage' }); // %PDF
    expect(logoFromBase64(10, 'iVBORw0KGgo<script>')).toEqual({ ok: false, reason: 'notImage' });
    expect(logoFromBase64(0, '')).toEqual({ ok: false, reason: 'notImage' });
  });
});
