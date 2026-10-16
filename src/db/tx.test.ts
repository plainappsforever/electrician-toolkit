/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { migrate } from './migrations';
import { setSetting, getSetting } from './settings';
import { withRead, withTransaction, withWrite } from './tx';
import type { Db } from './types';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// The template's demo `items` repository was removed in P1; the queue is probed on a test-only table of the same
// shape so these tests do not depend on any app table (migration 2 drops the template `items` table, D44).
async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  await db.execAsync("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)");
  return db;
}

function addItem(db: Db, input: { title: string; note: string }, now: number): Promise<number> {
  return withWrite(db, async (tx) => {
    const result = await tx.runAsync('INSERT INTO items (title, note, created_at) VALUES (?, ?, ?)', input.title, input.note, now);
    return result.lastInsertRowId;
  });
}

async function listItems(db: Db): Promise<{ title: string }[]> {
  return db.getAllAsync<{ title: string }>('SELECT title FROM items ORDER BY created_at DESC, id DESC');
}

async function titles(db: Awaited<ReturnType<typeof freshDb>>) {
  return (await listItems(db)).map((i) => i.title).sort();
}

describe('write queue', () => {
  it('(a) keeps a write issued during a failing transaction', async () => {
    const db = await freshDb();
    const failing = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO items (title, created_at) VALUES ('inside', 1)");
      await tick();
      throw new Error('boom');
    });
    const outside = tick().then(() => addItem(db, { title: 'outside', note: '' }, 2));
    const setting = setSetting(db, 'k', 'v'); // issued while the transaction is open
    await expect(failing).rejects.toThrow('boom');
    await outside;
    await setting;

    expect(await titles(db)).toEqual(['outside']);
    expect(await getSetting(db, 'k')).toBe('v');
  });

  it('(b) a second transaction started during one waits instead of throwing', async () => {
    const db = await freshDb();
    const order: string[] = [];
    const first = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO items (title, created_at) VALUES ('one', 1)");
      await tick();
      order.push('first done');
    });
    const second = withTransaction(db, async (tx) => {
      order.push('second start');
      await tx.runAsync("INSERT INTO items (title, created_at) VALUES ('two', 2)");
    });
    await Promise.all([first, second]);

    expect(order).toEqual(['first done', 'second start']);
    expect(await titles(db)).toEqual(['one', 'two']);
  });

  it('(c) a failing migration leaves no open transaction and user_version unchanged', async () => {
    const db = createTestDb();
    await migrate(db, ['CREATE TABLE a (id INTEGER);']);
    await expect(
      migrate(db, ['CREATE TABLE a (id INTEGER);', 'CREATE TABLE b (id INTEGER); INSERT INTO nope VALUES (1);'])
    ).rejects.toThrow();

    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeNull();
    await db.execAsync('BEGIN; COMMIT;'); // throws if a transaction were still open
  });

  it('nested transactions join the outer one; an inner failure undoes only the inner part', async () => {
    const db = await freshDb();
    await withTransaction(db, async (tx) => {
      await addItem(tx, { title: 'outer', note: '' }, 1); // withWrite on the handle joins
      await expect(
        withTransaction(tx, async (inner) => {
          await addItem(inner, { title: 'inner', note: '' }, 2);
          throw new Error('inner');
        })
      ).rejects.toThrow('inner');
      await withTransaction(tx, (inner) => addItem(inner, { title: 'kept', note: '' }, 3));
    });
    expect(await titles(db)).toEqual(['kept', 'outer']);

    await expect(
      withTransaction(db, async (tx) => {
        await addItem(tx, { title: 'lost', note: '' }, 4);
        await withWrite(tx, () => Promise.resolve());
        throw new Error('outer');
      })
    ).rejects.toThrow('outer');
    expect(await titles(db)).toEqual(['kept', 'outer']);
  });

  it('rejects a handle used after its unit ended', async () => {
    const db = await freshDb();
    let leaked!: Parameters<Parameters<typeof withWrite>[1]>[0];
    await withWrite(db, async (tx) => {
      leaked = tx;
    });
    expect(() => leaked.runAsync('SELECT 1')).toThrow('after its write unit ended');
  });
  it('reads never observe the uncommitted rows of a unit that rolls back', async () => {
    const db = await freshDb();
    const seen: string[][] = [];
    const failing = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO items (title, created_at) VALUES ('ghost', 1)");
      await tick();
      expect(await titles(tx)).toEqual(['ghost']); // inside the unit its own rows are visible
      throw new Error('boom');
    });
    // Reads issued while the unit is open (plain helpers and withRead) wait for it to end.
    const reads = [
      tick().then(() => titles(db).then((t) => seen.push(t))),
      withRead(db, async (r) => seen.push((await listItems(r)).map((i) => i.title))),
    ];
    await expect(failing).rejects.toThrow('boom');
    await Promise.all(reads);

    expect(seen[1]).toEqual([]); // withRead waited for the rollback
    expect(await titles(db)).toEqual([]);
  });
});
