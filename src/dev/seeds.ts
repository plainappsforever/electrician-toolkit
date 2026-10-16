// Named seeds for the development-only route `electrician-dev://debug/seed?set=<name>` (V1_PLAN rule 12, P5 wires the
// route). A seed WIPES everything (settings included, so defaults apply) and loads its data in one transaction; a
// failure leaves the previous data untouched. Results are computed by the real engine, never typed in.
import { saveCalculation } from '@/db/calculations';
import { wipeAllData } from '@/db/backup';
import { createCircuit, createProject } from '@/db/projects';
import { createCableTable } from '@/db/tables';
import { withTransaction } from '@/db/tx';
import type { Db } from '@/db/types';
import { compute, type CalcInput, type CalcKind } from '@/engine';

export const SEED_NAMES = ['empty', 'e1', 'table', 'many', 'huge'] as const;
export type SeedName = (typeof SEED_NAMES)[number];
export const isSeedName = (x: string): x is SeedName => (SEED_NAMES as readonly string[]).includes(x);

/**
 * The example table (SPEC E3). Its values ARE published ones (review #11, D59): IEC 60364-5-52:2009 Table B.52.2,
 * reference method C, Cu/PVC 70 °C, 30 °C, 2 loaded conductors, as publicly restated — 2.5 → 27, 4 → 36, 6 → 46,
 * 10 → 63 A exactly; 1.5 mm² is 19.5 A there, rounded to 20 A for SPEC E3. The labels say so wherever it appears.
 * Licensing (D14): IEC tables may not be reproduced without permission, so this is a development/test seed only —
 * never in a release build's data, never in store screenshots.
 */
export const EXAMPLE_TABLE = {
  meta: {
    name: 'Example — IEC 60364-5-52 Table B.52.2, method C (development seed)',
    sourceNote:
      'IEC 60364-5-52:2009 Table B.52.2, reference method C, copper, PVC 70 °C, 30 °C ambient, 2 loaded conductors — values as publicly restated (ecalpro.com); 1.5 mm² rounded from 19.5 A to 20 A for example E3. Development and test seed only, not shipped in the app.',
    material: 'cu' as const,
    insulationMaxC: 70,
    referenceAmbientC: 30,
    methodLabel: 'example',
    loadedConductors: 2 as const,
  },
  rows: [
    { sizeMm2: 1.5, izA: 20 },
    { sizeMm2: 2.5, izA: 27 },
    { sizeMm2: 4, izA: 36 },
    { sizeMm2: 6, izA: 46 },
    { sizeMm2: 10, izA: 63 },
  ],
};

/** SPEC §8 E1, E3 and E4 — the same inputs as test/fixtures/engine. */
export const E1_INPUT: CalcInput = {
  system: 'ac1',
  voltage: 230,
  current: 16,
  length: { value: 18, unit: 'm' },
  material: 'cu',
  size: { value: 1.5, unit: 'mm2' },
  cosPhi: 1,
  limitPercent: 3,
} as CalcInput;
export const E3_INPUT: CalcInput = {
  ib: 13,
  device: { type: 'mcb', curve: 'B', ratedCurrent: 16 },
  table: {
    tableName: EXAMPLE_TABLE.meta.name,
    sourceNote: EXAMPLE_TABLE.meta.sourceNote,
    sizeMm2: 1.5,
    izA: 20,
    insulationMaxC: 70,
    referenceAmbientC: 30,
  },
  ambientC: 35,
  fGroup: 0.8,
} as CalcInput;
export const E4_INPUT: CalcInput = {
  mode: 'calculated',
  u0: 230,
  ze: 0.35,
  material: 'cu',
  lineSize: { value: 1.5, unit: 'mm2' },
  peSize: { value: 1.5, unit: 'mm2' },
  length: { value: 25, unit: 'm' },
  loopTempC: 70,
  device: { type: 'mcb', curve: 'B', ratedCurrent: 16 },
  cmin: 1,
} as CalcInput;

export type SeedCounts = { projects: number; circuits: number; calculations: number; tables: number };

const draft = (kind: CalcKind, input: CalcInput, title: string) => ({ kind, input, result: compute(kind, input as never), title });

async function loadE1(tx: Db, now: number): Promise<SeedCounts> {
  const project = await createProject(tx, { name: 'Müller, Küche', client: 'Familie Müller', site: 'Musterstraße 1' }, now);
  const circuit = await createCircuit(tx, project, { label: 'F3 Steckdosen' }, now + 1);
  await saveCalculation(tx, { projectId: project, circuitId: circuit }, draft('vdrop', E1_INPUT, 'Spannungsfall F3'), now + 2);
  await saveCalculation(tx, { projectId: project, circuitId: circuit }, draft('coord', E3_INPUT, 'Schutz F3'), now + 3);
  await saveCalculation(tx, { projectId: project, circuitId: circuit }, draft('loop', E4_INPUT, 'Schleife F3'), now + 4);
  return { projects: 1, circuits: 1, calculations: 3, tables: 0 };
}

const MANY = { projects: 200, circuits: 10, calculations: 5 } as const;
/** `huge`: 16 500 calculations, a backup of ≈ 95.5 MiB — just under the 100 MiB restore cap (10 000 calculations = 57.9 MiB) (D57, P7 Android memory check). */
const HUGE = { projects: 330, circuits: 10, calculations: 5 } as const;

/** A13: 200 projects × 10 circuits × 5 calculations, written with plain inserts in the one seed transaction. */
async function loadMany(tx: Db, now: number, size: { projects: number; circuits: number; calculations: number } = MANY): Promise<SeedCounts> {
  const kinds: [CalcKind, CalcInput][] = [
    ['vdrop', E1_INPUT],
    ['coord', E3_INPUT],
    ['loop', E4_INPUT],
    ['vdrop', { ...(E1_INPUT as object), size: { value: 2.5, unit: 'mm2' } } as CalcInput],
    ['current', { system: 'ac1', voltage: 230, power: 3680, cosPhi: 1 } as CalcInput],
  ];
  const prepared = kinds.map(([kind, input]) => {
    const result = compute(kind, input as never);
    return { kind, inputs: JSON.stringify(result.usedInput), result: JSON.stringify(result), engine: result.engineVersion, profile: result.profileId, pv: result.profileVersion };
  });
  let t = now;
  for (let p = 1; p <= size.projects; p++) {
    const project = await tx.runAsync(
      "INSERT INTO projects (name, client, site, notes, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
      `Project ${String(p).padStart(3, '0')}`,
      `Client ${p}`,
      `Site ${p}`,
      t,
      t
    );
    for (let c = 1; c <= size.circuits; c++) {
      const circuit = await tx.runAsync(
        "INSERT INTO circuits (project_id, label, notes, sort, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?)",
        project.lastInsertRowId,
        `F${c}`,
        c,
        t,
        t
      );
      for (let k = 0; k < size.calculations; k++) {
        const x = prepared[k];
        await tx.runAsync(
          `INSERT INTO calculations (project_id, circuit_id, kind, title, note, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
          project.lastInsertRowId,
          circuit.lastInsertRowId,
          x.kind,
          `P${p} F${c} #${k + 1}`,
          x.inputs,
          x.result,
          x.engine,
          x.profile,
          x.pv,
          t,
          t
        );
        t++;
      }
    }
  }
  return { projects: size.projects, circuits: size.projects * size.circuits, calculations: size.projects * size.circuits * size.calculations, tables: 0 };
}

/** Wipes all data and loads the named seed in one transaction. */
export async function loadSeed(db: Db, name: SeedName, now = Date.now()): Promise<SeedCounts> {
  return withTransaction(db, async (tx) => {
    await wipeAllData(tx);
    switch (name) {
      case 'empty':
        return { projects: 0, circuits: 0, calculations: 0, tables: 0 };
      case 'e1':
        return loadE1(tx, now);
      case 'table':
        await createCableTable(tx, EXAMPLE_TABLE.meta, EXAMPLE_TABLE.rows, now);
        return { projects: 0, circuits: 0, calculations: 0, tables: 1 };
      case 'many':
        return loadMany(tx, now);
      case 'huge':
        return loadMany(tx, now, HUGE);
    }
  });
}
