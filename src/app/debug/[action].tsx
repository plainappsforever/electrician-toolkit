// Development-only links for UI tests (V1_PLAN rule 12): `electrician-dev://debug/seed?set=<name>` wipes the database and
// loads a named seed; `debug/probe` runs the device probes; `debug/restore-timing` times the 56 MB restore (A13, D57);
// `debug/flags?share=off&pick=<fixture>|last|none` switches the share sheet off / names the file the next picker call
// returns; `debug/restore?fixture=<file>|last` and `debug/import-table?fixture=<file>&id=<n>` do that and open the screen;
// `debug/pdfprobe[?zoom=<n>]` renders the report documents into Documents/dev-out/ for scripts/verify-pdfs.mjs (D75).
// In a release build `__DEV__` is false: the dynamic requires below are folded away, so neither the seeds (the `table`
// seed holds IEC values, D59) nor the probes are part of a preview/production bundle, and this route only redirects.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { Screen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { withRead } from '@/db/tx';
import { useDb } from '@/hooks/use-db';
import { applyLanguagePreference } from '@/i18n';
import { appVersion } from '@/hooks/use-report-pdf';
import { applyThemePreference } from '@/lib/theme-preference';

// `__DEV__ ? require(…) : null` is folded to `null` in a release bundle, so the modules are not bundled at all.
/* eslint-disable @typescript-eslint/no-require-imports */
const seeds: typeof import('@/dev/seeds') | null = __DEV__ ? require('@/dev/seeds') : null;
const probes: typeof import('@/dev/probe') | null = __DEV__ ? require('@/dev/probe') : null;
const flags: typeof import('@/dev/flags') | null = __DEV__ ? require('@/dev/flags') : null;
const pdfProbe: typeof import('@/dev/pdf-probe') | null = __DEV__ ? require('@/dev/pdf-probe') : null;
const pdfExp: typeof import('@/dev/pdf-exp') | null = __DEV__ ? require('@/dev/pdf-exp') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

export default function DebugRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DebugBody />;
}

function DebugBody() {
  const { action, set, share, pick, fixture, id, zoom } = useLocalSearchParams<{ action: string; set?: string; share?: string; pick?: string; fixture?: string; id?: string; zoom?: string }>();
  const db = useDb();
  const router = useRouter();
  const [lines, setLines] = useState<string[]>(['…']);
  const [summary, setSummary] = useState('running');
  const ran = useRef(false);
  // the same connection on every render: one queue (V1_PLAN P5 note, D63)
  const [first] = useState(db);
  const sameConnection = first === db;

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        if (action === 'seed') {
          const { isSeedName, loadSeed } = seeds!;
          if (!set || !isSeedName(set)) return setSummary(`unknown seed ${String(set)}`);
          const t0 = Date.now();
          const counts = await loadSeed(db, set);
          applyLanguagePreference('system');
          applyThemePreference('system');
          setLines([`seed ${set}: ${JSON.stringify(counts)} in ${Date.now() - t0} ms`]);
          setSummary('seeded');
        } else if (action === 'probe') {
          const { runDbProbes, runIntlProbes } = probes!;
          const all = [...(await runDbProbes(db)), ...runIntlProbes(), { name: 'same connection on every render', ok: sameConnection, detail: '' }];
          const failed = all.filter((l) => !l.ok);
          setLines(all.map((l) => `${l.ok ? 'PASS' : 'FAIL'} ${l.name} — ${l.detail}`));
          const text = failed.length === 0 ? `PROBES PASSED ${all.length}/${all.length}` : `PROBES FAILED ${failed.length}/${all.length}`;
          console.log(`PROBE_RESULT ${text}\n${all.map((l) => `${l.ok ? 'PASS' : 'FAIL'} ${l.name} — ${l.detail}`).join('\n')}`);
          setSummary(text);
        } else if (action === 'flags') {
          const f = flags!.devFlags;
          if (share === 'off') f.skipShare = true;
          if (share === 'on') f.skipShare = false;
          if (pick !== undefined) f.pick = pick === 'none' || pick === '' ? null : pick;
          setLines([`skipShare ${String(f.skipShare)} pick ${String(f.pick)}`]);
          setSummary('flags set');
        } else if (action === 'restore') {
          flags!.devFlags.pick = fixture ?? 'last';
          router.replace('/backup');
        } else if (action === 'import-table') {
          flags!.devFlags.pick = fixture ?? null;
          let tableId = id;
          if (!tableId) tableId = String((await withRead(db, (r) => r.getFirstAsync<{ id: number }>('SELECT MAX(id) AS id FROM cable_tables')))?.id ?? '');
          router.replace({ pathname: '/table/import', params: { id: tableId } });
        } else if (action === 'pdfprobe') {
          const t0 = Date.now();
          const r = await pdfProbe!.runPdfProbe(db, appVersion(), zoom ? Number(zoom) : null);
          setLines(r.entries.map((e) => `${e.file}: ${e.pages} pages, ${e.bytes} bytes, ${e.ms} ms (+${e.buildMs} ms html), ${e.calculations} calculations`));
          const text = `PDFPROBE OK ${r.entries.length} files in ${Date.now() - t0} ms`;
          console.log(`PROBE_RESULT ${text}\n${r.json}`);
          setSummary(text);
        } else if (action === 'pdfexp') {
          const lines = await pdfExp!.runPdfExperiment((set ?? Object.keys(pdfExp!.CASES).join(',')).split(','), zoom ? Number(zoom) : null);
          setLines(lines);
          setSummary(`PDFEXP OK ${lines.length}`);
        } else if (action === 'restore-timing') {
          const { runRestoreTiming } = probes!;
          const r = await runRestoreTiming(db);
          setLines([
            `file ${r.fileMB.toFixed(1)} MB, ${r.calculations} calculations`,
            `seed ${Math.round(r.seedMs)} ms · export ${Math.round(r.exportMs)} ms · serialise ${Math.round(r.serializeMs)} ms`,
            `parse+validate ${Math.round(r.parseMs)} ms · restore ${Math.round(r.restoreMs)} ms`,
            r.detail,
          ]);
          const text = r.ok ? `RESTORE OK parse ${Math.round(r.parseMs)} ms restore ${Math.round(r.restoreMs)} ms` : 'RESTORE FAILED';
          console.log(`PROBE_RESULT ${text} | file ${r.fileMB.toFixed(1)} MB | seed ${Math.round(r.seedMs)} ms export ${Math.round(r.exportMs)} ms serialise ${Math.round(r.serializeMs)} ms | ${r.detail}`);
          setSummary(text);
        } else {
          setSummary(`unknown action ${String(action)}`);
        }
      } catch (e) {
        setSummary(`ERROR ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [action, set, share, pick, fixture, id, zoom, db, router, sameConnection]);

  return (
    <Screen testID="debug-screen">
      <ThemedText testID="probe-summary" type="smallBold">
        {summary}
      </ThemedText>
      <Button testID="debug-continue" variant="secondary" label="Continue" onPress={() => router.replace('/')} />
      {lines.map((l, i) => (
        <ThemedText key={i} testID={`probe-line-${i}`} type="small">
          {l}
        </ThemedText>
      ))}
    </Screen>
  );
}
