import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Journal, type LiveStake } from '../src/stake/journal';

const live = (session: string, value: number): LiveStake => ({
  roomId: 'stake-1',
  session,
  sessionId: 7,
  player: `w-${session}`,
  arenaId: 1,
  value,
  score: 100,
  kills: 2,
});

const tmpPath = () => join(mkdtempSync(join(tmpdir(), 'elymum-journal-')), 'journal.json');

describe('journal v2', () => {
  it('loot survives restart', () => {
    const path = tmpPath();
    const j1 = new Journal(path);
    const items = [
      { x: 10.5, y: 20, value: 1000 },
      { x: 30, y: 40.25, value: 7 },
    ];
    j1.commit({ roomId: 'stake-1', live: [live('s-a', 70)], loot: { roomId: 'arena-1-1', arenaId: 1, items } });
    j1.commit({ loot: { roomId: 'arena-2-1', arenaId: 2, items: [{ x: 1, y: 2, value: 3 }] } });
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2);

    const j2 = new Journal(path);
    expect(j2.recoverLoot(1)).toEqual(items.map((i) => ({ roomId: 'arena-1-1', arenaId: 1, ...i })));
    expect(j2.recoverLoot(2)).toEqual([{ roomId: 'arena-2-1', arenaId: 2, x: 1, y: 2, value: 3 }]);
    expect(j2.recoverLoot(3)).toEqual([]);
    expect(j2.live()).toEqual([live('s-a', 70)]);
    // crash recovery of live players leaves the loot on the floor
    j2.recoverLive(1);
    expect(new Journal(path).recoverLoot(1)).toHaveLength(2);

    // a commit replaces that instance's loot only; an empty list clears it
    j2.commit({ loot: { roomId: 'arena-1-1', arenaId: 1, items: [] } });
    const j3 = new Journal(path);
    expect(j3.recoverLoot(1)).toEqual([]);
    expect(j3.recoverLoot(2)).toHaveLength(1);
    expect(j3.lootTotal()).toBe(3);
  });

  it('drops the old Pass flag that older v2 files carry on live stakes', () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify({ version: 2, pending: [], live: [{ ...live('s-p', 90), hasPass: true }], loot: [], updatedAt: 1 }));
    const j = new Journal(path);
    expect(j.live()).toEqual([live('s-p', 90)]);
    j.commit({});
    expect(JSON.parse(readFileSync(path, 'utf8')).live[0]).not.toHaveProperty('hasPass');
  });

  it('v1 journal migrates', () => {
    const path = tmpPath();
    const v1 = {
      version: 1,
      pending: [
        {
          kind: 'settle',
          key: 's-old',
          player: 'w',
          arenaId: 1,
          session: 's-old',
          sessionId: 3,
          payout: 150,
          score: 10,
          kills: 1,
          xp: 5,
          reason: 'cashout',
          attempts: 0,
          nextAttemptAt: 0,
          createdAt: 0,
        },
      ],
      live: [{ roomId: 'stake-1', session: 's-a', sessionId: 4, player: 'wa', arenaId: 1, value: 70, score: 1, kills: 0 }],
      updatedAt: 1,
    };
    writeFileSync(path, JSON.stringify(v1));
    const logs: string[] = [];
    const j = new Journal(path, (m) => logs.push(m));
    expect(logs.some((l) => /unreadable/.test(l))).toBe(false);
    expect(j.settlements().map((p) => [p.key, p.payout])).toEqual([['s-old', 150]]);
    expect(j.live()).toEqual([v1.live[0]]);
    expect(j.recoverLoot(1)).toEqual([]);
    // the next write upgrades the file
    j.commit({});
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.loot).toEqual([]);
    expect(onDisk.pending).toHaveLength(1);
    expect(onDisk.live).toHaveLength(1);
  });

  it('loot is keyed per instance and merged into instance 1 on recovery', () => {
    const path = tmpPath();
    const j1 = new Journal(path);
    j1.commit({ loot: { roomId: 'arena-1-1', arenaId: 1, items: [{ x: 1, y: 1, value: 100 }] } });
    j1.commit({ loot: { roomId: 'arena-1-2', arenaId: 1, items: [{ x: 2, y: 2, value: 40 }, { x: 3, y: 3, value: 2 }] } });
    j1.commit({ loot: { roomId: 'arena-2-1', arenaId: 2, items: [{ x: 9, y: 9, value: 5 }] } });
    // instance 2 picking its loot up clears only its own records
    j1.commit({ loot: { roomId: 'arena-1-2', arenaId: 1, items: [{ x: 2, y: 2, value: 40 }] } });
    expect(j1.lootTotal()).toBe(145);

    const j2 = new Journal(path);
    expect(j2.recoverLoot(1).map((l) => l.value).sort()).toEqual([100, 40]);
    const adopted = j2.adoptLoot(1, 'arena-1-1');
    expect(adopted.map((l) => l.value).sort()).toEqual([100, 40]);
    expect(j2.recoverLoot(1).every((l) => l.roomId === 'arena-1-1')).toBe(true);
    expect(j2.recoverLoot(2)).toEqual([{ roomId: 'arena-2-1', arenaId: 2, x: 9, y: 9, value: 5 }]);
    // the merge is on disk in one write
    const j3 = new Journal(path);
    expect(j3.lootTotal()).toBe(145);
    expect(j3.recoverLoot(1).map((l) => l.roomId)).toEqual(['arena-1-1', 'arena-1-1']);
    // adoption is one-shot per arena: a second construction cannot restore the same loot twice
    expect(j2.adoptLoot(1, 'arena-1-1')).toEqual([]);
    expect(j2.lootTotal()).toBe(145);
    // the merged instance's next write keeps everything it restored
    j3.commit({ loot: { roomId: 'arena-1-1', arenaId: 1, items: adopted } });
    expect(new Journal(path).lootTotal()).toBe(145);
  });

  it('v2 loot without an instance id belongs to instance 1', () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify({ version: 2, pending: [], live: [], loot: [{ arenaId: 3, x: 1, y: 2, value: 9 }], updatedAt: 1 }));
    const j = new Journal(path);
    expect(j.recoverLoot(3)).toEqual([{ roomId: 'arena-3-1', arenaId: 3, x: 1, y: 2, value: 9 }]);
  });
});

describe('sweep ids and the contract binding (EVM)', () => {
  const sweep = (key: string, arenaId = 1) => ({ kind: 'sweep' as const, key, arenaId, roomId: `arena-${arenaId}-1`, round: 1, amount: 10, attempts: 0, nextAttemptAt: 0, createdAt: 0 });

  it('assigns monotonic sweep ids per arena, above the on-chain lastSweepId, and keeps them across reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-journal-sweep-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    j.commit({ enqueue: [sweep('a'), sweep('b'), sweep('c', 2)] });
    expect(j.assignSweepId('a', 0)).toBe(1);
    expect(j.assignSweepId('a', 0)).toBe(1); // an item keeps its id
    expect(j.assignSweepId('b', 7)).toBe(8); // above the chain's last id
    expect(j.assignSweepId('c', 0)).toBe(1); // per arena
    j.markSent('b', '0xabc', 5);
    j.remove('a');
    j.remove('b');
    const back = new Journal(path);
    expect(back.lastSweepId(1)).toBe(8);
    back.enqueue(sweep('d'));
    expect(back.assignSweepId('d', 0)).toBe(9);
    expect((back.pending.find((p) => p.key === 'c') as { sweepId?: number }).sweepId).toBe(1);
  });

  it('binds to one arena contract; another one only once nothing is owed', () => {
    const j = new Journal(null);
    expect(j.contract).toBeNull();
    expect(j.bindContract('0x00000000000000000000000000000000000000AA')).toBe(true);
    expect(j.contract).toBe('0x00000000000000000000000000000000000000aa');
    j.enqueue(sweep('x'));
    expect(j.bindContract('0x00000000000000000000000000000000000000BB')).toBe(false);
    expect(j.bindContract('0x00000000000000000000000000000000000000aa')).toBe(true);
    j.remove('x');
    expect(j.isIdle()).toBe(true);
    expect(j.bindContract('0x00000000000000000000000000000000000000BB')).toBe(true);
    expect(j.lastSweepId(1)).toBe(0);
  });
});
