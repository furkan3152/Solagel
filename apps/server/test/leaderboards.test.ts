import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEADERBOARD_EPOCH, Leaderboards, type LbRecord } from '../src/leaderboards';

const NOW = Date.UTC(2026, 10, 2, 12);
const rec = (name: string, score: number, at = NOW): LbRecord => ({ name, score, skin: 0, wallet: null, kills: 1, at });

describe('leaderboards: epochs and the reset', () => {
  it('a file from an older epoch (or none) is backed up and the boards start empty, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-lb-'));
    const path = join(dir, 'leaderboards.json');
    // written before epochs existed
    writeFileSync(path, JSON.stringify({ day: '2026-11-02', daily: [rec('Old', 500)], allTime: [rec('Old', 500), rec('Older', 400)] }));
    const logs: string[] = [];
    const lb = new Leaderboards(path, NOW, { log: (m) => logs.push(m) });
    expect(lb.snapshot(10, NOW)).toMatchObject({ daily: [], allTime: [] });
    expect(lb.info(NOW)).toMatchObject({ epoch: LEADERBOARD_EPOCH, resetBy: 'epoch', resetAt: NOW });
    expect(logs.join()).toMatch(/epoch 1 → 2: daily and all-time boards reset/);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ epoch: LEADERBOARD_EPOCH, daily: [], allTime: [] });
    const backups = readdirSync(dir).filter((f) => f.startsWith('leaderboards.json.epoch-1-'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, backups[0]), 'utf8')).allTime).toHaveLength(2);

    // the next start of the same code keeps what was played since
    lb.submit(rec('New', 300));
    lb.flush();
    const again = new Leaderboards(path, NOW + 1000, { log: (m) => logs.push(m) });
    expect(again.snapshot(10, NOW + 1000).allTime.map((r) => r.name)).toEqual(['New']);
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(1);
    // a later epoch resets again
    const next = new Leaderboards(path, NOW + 2000, { epoch: LEADERBOARD_EPOCH + 1 });
    expect(next.snapshot(10, NOW + 2000).allTime).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(2);
  });

  it('reset clears both boards, writes at once and keeps a backup with the unflushed records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-lb-'));
    const path = join(dir, 'leaderboards.json');
    const lb = new Leaderboards(path, NOW);
    lb.submit(rec('A', 100));
    lb.submit(rec('B', 200));
    const out = lb.reset('0xAdmin', NOW + 5);
    expect(out).toMatchObject({ daily: 2, allTime: 2 });
    expect(out.backup).toMatch(/leaderboards\.json\.reset-\d+\.bak$/);
    expect(JSON.parse(readFileSync(out.backup!, 'utf8')).allTime.map((r: LbRecord) => r.name)).toEqual(['B', 'A']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ daily: [], allTime: [], resetBy: '0xAdmin', resetAt: NOW + 5 });
    expect(lb.snapshot(10, NOW + 5)).toMatchObject({ daily: [], allTime: [] });
    lb.submit(rec('C', 50, NOW + 10));
    expect(lb.snapshot(10, NOW + 10).allTime.map((r) => r.name)).toEqual(['C']);
    // in memory: no file, no backup
    const mem = new Leaderboards(null, NOW);
    mem.submit(rec('A', 1));
    expect(mem.reset('x', NOW)).toEqual({ daily: 1, allTime: 1, backup: null });
  });
});
