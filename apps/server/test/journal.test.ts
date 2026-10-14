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
  hasPass: true,
});

const tmpPath = () => join(mkdtempSync(join(tmpdir(), 'slana-journal-')), 'journal.json');

describe('journal v2', () => {
  it('loot survives restart', () => {
    const path = tmpPath();
    const j1 = new Journal(path);
    const items = [
      { x: 10.5, y: 20, value: 1000 },
      { x: 30, y: 40.25, value: 7 },
    ];
    j1.commit({ roomId: 'stake-1', live: [live('s-a', 70)], loot: { arenaId: 1, items } });
    j1.commit({ loot: { arenaId: 2, items: [{ x: 1, y: 2, value: 3 }] } });
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2);

    const j2 = new Journal(path);
    expect(j2.recoverLoot(1)).toEqual(items.map((i) => ({ arenaId: 1, ...i })));
    expect(j2.recoverLoot(2)).toEqual([{ arenaId: 2, x: 1, y: 2, value: 3 }]);
    expect(j2.recoverLoot(3)).toEqual([]);
    expect(j2.live()).toEqual([live('s-a', 70)]);
    // crash recovery of live players leaves the loot on the floor
    j2.recoverLive(1);
    expect(new Journal(path).recoverLoot(1)).toHaveLength(2);

    // a commit replaces that arena's loot only; an empty list clears it
    j2.commit({ loot: { arenaId: 1, items: [] } });
    const j3 = new Journal(path);
    expect(j3.recoverLoot(1)).toEqual([]);
    expect(j3.recoverLoot(2)).toHaveLength(1);
    expect(j3.lootTotal()).toBe(3);
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
    expect(j.pending.map((p) => [p.key, p.payout])).toEqual([['s-old', 150]]);
    expect(j.live()).toEqual([{ ...v1.live[0], hasPass: false }]);
    expect(j.recoverLoot(1)).toEqual([]);
    // the next write upgrades the file
    j.commit({});
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.loot).toEqual([]);
    expect(onDisk.pending).toHaveLength(1);
    expect(onDisk.live).toHaveLength(1);
  });
});
