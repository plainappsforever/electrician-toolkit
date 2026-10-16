// The report HTML is written in CSS points/mm on an A4 or Letter page (src/lib/report-html.ts). The two print engines
// behave differently, so each has a profile, MEASURED for this document on the devices with scripts/verify-pdfs.mjs (pdf.js
// re-parse of PDFs pulled from the simulator and the emulator; D75, V1_LOG P6). The sibling apps' factors were measured for
// other documents and are not reused blindly.
//  - Android (Chromium print): 1 CSS pt = 1 PDF pt, `@page` and the repeating `<tfoot>` work (note + versions on every page).
//  - iOS (WKWebView print formatter, expo-print): 1 CSS pt prints as 1.0632 PDF pt without a correction → `html{zoom:0.9375}`
//    (body 9.5 pt → 9.5 pt); `@page` margins are ignored, so the top/bottom margins are handed to expo-print; neither
//    `<thead>`/`<tfoot>` nor `position: fixed` repeat on later pages (measured with synthetic pages, D75), so the
//    responsibility note closes every calculation block (`.calc-note`) and the versions line prints once at the end
//    (its bottom padding and the duplicate note are dropped: they pushed a blank last page, seen in the pulled Letter PDF).
// PURE.
import type { Paper } from '@/db/settings';

export type PrintPlatform = 'ios' | 'android';
export type PrintMargins = { left: number; right: number; top: number; bottom: number };

export type PrintProfile = { zoom: number; margins: PrintMargins | null; css: string };

/** 11 mm top and 11 mm bottom in points; the side margins are the report's own body padding (13 mm). */
const IOS_MARGINS: PrintMargins = { left: 0, right: 0, top: 31, bottom: 31 };

export const PRINT_PROFILE: Record<PrintPlatform, PrintProfile> = {
  ios: { zoom: 0.9375, margins: IOS_MARGINS, css: '.top-space{display:none}.calc-note{display:block}.foot{margin-top:2mm;padding-bottom:0}.foot .resp-note{display:none}' },
  android: { zoom: 1, margins: null, css: '' },
};

/** Adds the engine's zoom and CSS (nothing else): the report's own CSS already sets `@page`, margins and the footer. */
export function printHtml(html: string, platform: PrintPlatform, paper: Paper, zoomOverride?: number): string {
  void paper; // reserved: a per-paper factor if a measurement ever shows one (A4 and Letter share the factor today)
  const p = PRINT_PROFILE[platform];
  const zoom = zoomOverride ?? p.zoom;
  const css = `${zoom === 1 ? '' : `html{zoom:${zoom}}`}${p.css}`;
  return css === '' ? html : html.replace('</head>', `<style>${css}</style></head>`);
}
