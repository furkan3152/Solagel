import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerFlag, TICK_MS, roundAt } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { DevFakeChain } from '../src/chain/dev-fake';
import { NullChain } from '../src/chain/types';
import { mulberry32 } from '../src/game/rng';
import { IntegrityService } from '../src/integrity/service';
import { IntegrityStore } from '../src/integrity/store';
import { Leaderboards } from '../src/leaderboards';
import { Room } from '../src/rooms/room';
import { Journal, itemAmount, type SettlementItem } from '../src/stake/journal';
import { fakeConn } from './helpers';

const FEE = 1_000_000_007;
const ROUND = { roundMs: 40_000, closeMs: 10_000 };

const settle = (key: string, payout: number, held = true): SettlementItem => ({
  kind: 'settle',
  key,
  player: `wallet-${key}`,
  arenaId: 1,
  session: key,
  sessionId: 1,
  payout,
  score: 0,
  kills: 0,
  xp: 0,
  reason: 'round',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 0,
  ...(held ? { held: { at: 1, score: 95, why: 'test', flags: ['f1'] } } : {}),
});

describe('journal holds', () => {
  it('release and settle-at-0 move nothing out of the books, and survive a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-hold-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    j.commit({ enqueue: [settle('A', 500), settle('B', 700), settle('C', 900, false)] });
    const books = (x: Journal) => x.pending.reduce((s, p) => s + itemAmount(p), 0) + x.forfeitedByArena(1);
    expect(books(j)).toBe(2100);
    expect(j.held().map((h) => h.key)).toEqual(['A', 'B']);

    j.release('A', 10);
    expect(j.held().map((h) => h.key)).toEqual(['B']);
    expect(j.pending.find((p) => p.key === 'A')).toMatchObject({ payout: 500, nextAttemptAt: 10 });
    expect(books(j)).toBe(2100);

    const { forfeit } = j.settleZero('B', 'confirmed collusion', 'admin1', 20);
    expect(forfeit).toMatchObject({ key: 'B', amount: 700, arenaId: 1, by: 'admin1', reason: 'confirmed collusion' });
    expect(j.pending.find((p) => p.key === 'B')).toMatchObject({ payout: 0 });
    expect(j.held()).toEqual([]);
    expect(books(j)).toBe(2100);

    // only held items can be released or zeroed
    expect(() => j.release('C')).toThrow();
    expect(() => j.settleZero('A', 'x', 'y')).toThrow();
    expect(() => j.release('nope')).toThrow();

    // the file on disk says the same (held state and forfeits are journaled)
    const back = new Journal(path);
    expect(books(back)).toBe(2100);
    expect(back.forfeits()).toHaveLength(1);
    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.forfeits[0].amount).toBe(700);

    // a held item survives a restart held
    const k = new Journal(join(dir, 'j2.json'));
    k.commit({ enqueue: [settle('H', 42)] });
    expect(new Journal(join(dir, 'j2.json')).held().map((h) => h.key)).toEqual(['H']);
  });

  it('the dev fake chain never settles a held item until it is released', async () => {
    const journal = new Journal(null);
    const chain = new DevFakeChain(journal, () => {}, 5, { tokenSet: true });
    const settled: string[] = [];
    chain.onSettled((e) => settled.push(e.key));
    const s = (await chain.getSession(1, 'Player1111111111111111111111111111111111'))!;
    journal.commit({ enqueue: [{ ...settle(s.address, 1234), player: s.player }] });
    chain.kick();
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toEqual([]);
    journal.release(s.address);
    chain.kick();
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toEqual([s.address]);
    await chain.stop();
  });
});

/** An integrity service whose risk is fixed per wallet (the hold path, not the detectors, is under test). */
class FixedRisk extends IntegrityService {
  constructor(
    journal: Journal,
    private readonly risky: (wallet: string) => boolean,
  ) {
    super({ store: new IntegrityStore(null), journal, kick: () => {} });
    this.updateSettings({ autoHold: true, holdScore: 90 }, 'test');
  }
  override evaluate(wallet: string): { score: number; flags: string[] } {
    return { score: this.risky(wallet) ? 97 : 10, flags: [] };
  }
}

describe('auto-hold keeps arena money conservation', () => {
  it('ledger + loot + pending + forfeited == entry fees − paid, every tick, with holds, releases and settle-at-0 (seeded)', () => {
    const rng = mulberry32(777);
    const journal = new Journal(null);
    const integrity = new FixedRisk(journal, (w) => Number(w.slice(6)) % 3 !== 0);
    let clock = roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 5_000;
    const room = new Room(
      { id: 'arena-1-1', mode: 'arena', name: 'Arena', maxPlayers: 50, bots: { target: 8, min: 8, max: 8 }, stake: { arenaId: 1, buyIn: FEE }, seed: 99 },
      { chain: new NullChain(), journal, leaderboards: new Leaderboards(null), log: () => {}, now: () => clock, round: ROUND, integrity },
    );
    const world = room.world;
    const ledger = room.ledger!;
    let fees = 0;
    let paid = 0;
    let joins = 0;
    const conns: ReturnType<typeof fakeConn>[] = [];
    const join = () => {
      const n = ++joins;
      const conn = fakeConn(`wallet${n}`, `10.0.0.${n}`);
      const p = room.join(conn, {
        name: `staker${n}`,
        skin: 1,
        flags: PlayerFlag.Staker,
        stake: { player: `wallet${n}`, session: `session${n}`, sessionId: n, arenaId: 1, entryFee: FEE, value: FEE, openedAt: Math.floor(Date.now() / 1000) },
      });
      fees += FEE;
      p.cells[0].setMass(20 + rng() * 300);
      p.shieldUntil = 0;
      conns.push(conn);
    };
    for (let i = 0; i < 8; i++) join();

    let held = 0;
    let released = 0;
    let zeroed = 0;
    const seenHeld = new Set<string>();
    const ticks = Math.ceil(130_000 / TICK_MS);
    for (let t = 0; t < ticks; t++) {
      for (const conn of conns) {
        const p = conn.player;
        if (!p?.alive || rng() >= 0.05) continue;
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        const c = p.center();
        for (const o of world.players.values()) {
          if (o === p || !o.alive) continue;
          const oc = o.center();
          const d = Math.hypot(oc.x - c.x, oc.y - c.y);
          if (d < bd) {
            bd = d;
            best = oc;
          }
        }
        if (best) world.setTarget(p.id, best.x, best.y);
      }
      const r = roundAt(clock, ROUND.roundMs, ROUND.closeMs);
      if (conns.filter((c) => c.player?.alive).length < 8 && clock < r.joinsCloseAt && rng() < 0.02) join();
      clock += TICK_MS;
      room.tick(TICK_MS);

      for (const h of journal.held()) {
        if (!seenHeld.has(h.key)) {
          seenHeld.add(h.key);
          held++;
          // only profitable payouts of risky wallets are held
          expect(Number(h.player.slice(6)) % 3).not.toBe(0);
          expect(h.payout!).toBeGreaterThan(FEE);
          expect(h.reason).toBe('round');
        }
      }
      // the chain pays what is not held
      const due = journal.pending.find((p) => !(p.kind === 'settle' && p.held));
      if (due && rng() < 0.05) {
        paid += itemAmount(due);
        journal.remove(due.key);
      }
      // the admin decides on held items now and then
      const h = journal.held()[0];
      if (h && rng() < 0.02) {
        if ((released + zeroed) % 2 === 0) {
          journal.release(h.key, clock);
          released++;
        } else {
          journal.settleZero(h.key, 'test decision', 'admin', clock);
          zeroed++;
        }
      }
      const pending = journal.pending.reduce((s, p) => s + itemAmount(p), 0);
      const loot = world.loot().reduce((s, l) => s + l.value, 0);
      const lhs = ledger.total() + loot + pending + journal.forfeitedByArena(1);
      if (lhs !== fees - paid) throw new Error(`tick ${t}: ${ledger.total()} + ${loot} + ${pending} + ${journal.forfeitedByArena(1)} != ${fees} - ${paid}`);
    }
    expect(held).toBeGreaterThan(0);
    expect(released).toBeGreaterThan(0);
    expect(zeroed).toBeGreaterThan(0);
    // settled at 0: the payout is 0 and the forfeit equals what the ticket held
    expect(journal.forfeits().every((f) => f.amount > FEE)).toBe(true);
  }, 120_000);

  it('auto-hold off (the default) never holds', () => {
    const journal = new Journal(null);
    const svc = new IntegrityService({ store: new IntegrityStore(null), journal, kick: () => {} });
    expect(svc.settings.autoHold).toBe(false);
    const room = { id: 'arena-1-1', now: () => 1_791_000_000_000, round: () => ({ n: 1, endsAt: 1_791_000_000_000 + 1, joinsCloseAt: 0 }), opts: { stake: { arenaId: 1, buyIn: 10 } } };
    svc.join(room, 1, { ip: '1.2.3.4', fp: null }, { player: 'w', session: 's', sessionId: 1, arenaId: 1, entryFee: 10 });
    const item = settle('s', 1000, false);
    svc.settle(room, 1, item, { reason: 'round', payout: 1000, killer: null, killerIsBot: false });
    expect(item.held).toBeUndefined();
  });
});
