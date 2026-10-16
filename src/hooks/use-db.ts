import { useSQLiteContext } from '@/db/provider';

import type { Db } from '@/db/types';

/**
 * The app's database handle. Screens use this and pass it to the data functions in `src/db/` (which queue every write
 * and read through `src/db/tx.ts`); they never call `runAsync`/`execAsync` themselves.
 */
export function useDb(): Db {
  return useSQLiteContext();
}
