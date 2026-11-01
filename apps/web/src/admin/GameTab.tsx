import { setPausedCall, updateArenaFrom } from '@elymum/sdk';
import { arenaName } from '@elymum/sdk/ops';
import { GAME_ACCESS_MODES, type GameAccess } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { SiteApiError, type BotAdminView, type BotKindSettings, type BotSettingsPatch } from '../site/api';
import { ArenaTab } from './ArenaTab';
import { CustomRoomsCard } from './CustomRoomsCard';
import { GAME_ACCESS_LABEL } from './site/SettingsTab';
import { Btn, Card, FormError, NeedsSession, type ChainCtx } from './ui';

/** One row of segments: the live one is marked, a click asks to switch. */
export function SwitchRow<T extends string>({
  label,
  options,
  value,
  busy,
  onPick,
  testId,
}: {
  label: string;
  options: readonly { id: T; label: string; note?: string }[];
  value: T | null;
  busy?: boolean;
  onPick: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="ad-switchrow" role="group" aria-label={label} data-testid={testId}>
      <span className="ad-switchrow__label mono">{label}</span>
      <div className="ad-switchrow__segs">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`ad-seg${value === o.id ? ' is-on' : ''}`}
            aria-pressed={value === o.id}
            disabled={busy || value === o.id}
            title={o.note}
            onClick={() => onPick(o.id)}
            data-value={o.id}
          >
            {value === o.id && <span className="ad-seg__dot" aria-hidden="true" />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ACCESS_OPTS = GAME_ACCESS_MODES.map((m) => ({ id: m, label: m === 'admins' ? 'Admins' : m === 'holders' ? 'Holders' : 'Public', note: GAME_ACCESS_LABEL[m].note }));

/** Game → start / stop: who may play (one switch row, saved on the server) and the arena's pause. */
function StartStopCard({ ctx }: { ctx: ChainCtx }) {
  const [access, setAccess] = useState<GameAccess | null>(null);
  const [env, setEnv] = useState<GameAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ctx.api) return;
    let live = true;
    ctx.api.settings().then(
      (r) => {
        if (!live) return;
        setAccess(r.settings.gameAccess);
        setEnv(r.gameAccessEnv ?? null);
      },
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [ctx.api]);
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  const pick = async (m: GameAccess) => {
    if (!ctx.api) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await ctx.api.saveSettings({ gameAccess: m });
      setAccess(r.settings.gameAccess);
      setEnv(r.gameAccessEnv ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Start / stop" id="game-switches" lede="Who may play is a server setting (instant, no transaction). The pause is on chain: it blocks new tickets only; settlements and refunds keep working.">
      <SwitchRow label="Who may play" options={ACCESS_OPTS} value={env ?? access} busy={busy || !ctx.api || !!env} onPick={(m) => void pick(m)} testId="game-access" />
      {env && <p className="ad-note">GAME_ACCESS={env} is set on the server: it wins over this switch.</p>}
      {arena && cfg && (
        <SwitchRow
          label="Arena tickets"
          options={[
            { id: 'open', label: 'Taking joins' },
            { id: 'paused', label: 'Paused' },
          ]}
          value={cfg.paused ? 'paused' : 'open'}
          onPick={(v) =>
            ctx.open({
              title: v === 'paused' ? 'Pause the arena (no new tickets)' : 'Unpause the arena',
              contract: 'ElymumArena',
              call: setPausedCall(arena, v === 'paused'),
              ownerOf: arena,
              owner: cfg.admin,
              note: v === 'paused' ? 'Pause blocks joins only; settlements and refunds keep working.' : undefined,
              onDone: () => ctx.refresh(),
            })
          }
          testId="arena-pause"
        />
      )}
      {arena && cfg && (ctx.status?.arena?.arenas.length ?? 0) > 0 && (
        <div className="ad-arenachips" role="group" aria-label="Arenas open for tickets">
          <span className="ad-switchrow__label mono">Per arena</span>
          {ctx.status!.arena!.arenas.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`ad-seg ad-seg--chip${x.enabled ? ' is-on' : ''}`}
              aria-pressed={x.enabled}
              data-testid={`arena-enable-${x.id}`}
              onClick={() =>
                ctx.open({
                  title: `${x.enabled ? 'Close' : 'Open'} arena #${x.id} ${arenaName(x.id)}`,
                  contract: 'ElymumArena',
                  call: updateArenaFrom(arena, x, { enabled: !x.enabled }),
                  ownerOf: arena,
                  owner: cfg.admin,
                  onDone: () => ctx.refresh(),
                })
              }
            >
              {x.enabled && <span className="ad-seg__dot" aria-hidden="true" />}#{x.id} {arenaName(x.id)}
            </button>
          ))}
        </div>
      )}
      <NeedsSession api={ctx.api} />
      <FormError error={err} />
      <div className="ad-actions">
        <a className="kb-btn kb-btn--secondary kb-btn--sm" href="/play">
          <span className="kb-btn__label">
            <span className="kb-btn__text">Open the arena as admin</span>
          </span>
        </a>
      </div>
    </Card>
  );
}

const KIND_LABEL: Record<string, string> = { practiceRookie: 'Practice · rookie', practicePro: 'Practice · pro', arena: 'Arenas', private: 'Private rooms' };
const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

/** The fields of a kind that changed (for a partial PUT). */
export function botsPatch(saved: BotAdminView['settings'], draft: BotAdminView['settings']): BotSettingsPatch {
  const out: BotSettingsPatch = {};
  for (const [kind, d] of Object.entries(draft.kinds)) {
    const s = saved.kinds[kind];
    if (!s) continue;
    const p: Record<string, unknown> = {};
    for (const f of ['enabled', 'cap', 'min', 'target'] as const) if (d[f] !== s[f]) p[f] = d[f];
    const mix: Record<string, number> = {};
    for (const [lvl, w] of Object.entries(d.mix)) if (s.mix[lvl] !== w) mix[lvl] = w;
    if (Object.keys(mix).length) p.mix = mix;
    if (Object.keys(p).length) (out.kinds ??= {})[kind] = p as never;
  }
  const t: Record<string, unknown> = {};
  for (const f of ['stakedPerArena', 'bankroll', 'gasHype'] as const) if (draft.testnet[f] !== saved.testnet[f]) t[f] = draft.testnet[f];
  const arenas: Record<string, { stakedBots?: number; bankroll?: string }> = {};
  for (const [id, a] of Object.entries(draft.testnet.arenas)) {
    const s = saved.testnet.arenas[id] ?? {};
    const p: { stakedBots?: number; bankroll?: string } = {};
    if (a.stakedBots !== s.stakedBots && a.stakedBots !== undefined) p.stakedBots = a.stakedBots;
    if (a.bankroll !== s.bankroll && a.bankroll !== undefined && a.bankroll !== '') p.bankroll = a.bankroll;
    if (Object.keys(p).length) arenas[id] = p;
  }
  if (Object.keys(arenas).length) t.arenas = arenas;
  if (Object.keys(t).length) out.testnet = t as never;
  return out;
}

function NumCell({ value, onChange, label, max }: { value: number; onChange: (n: number) => void; label: string; max: number }) {
  return (
    <input
      className="ad-input ad-input--num num"
      type="number"
      min={0}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
    />
  );
}

/** The fix for a staked-bot problem the server reports (null: no known fix, the text says it). */
export function stakedFix(problem: string): { text: string; hash: string } | null {
  if (/minter|mint/i.test(problem)) return { text: 'Grant minter to the server key: Setup → Finish setup.', hash: '#setup' };
  if (/hype|gas|fund|balance/i.test(problem)) return { text: 'Fund the server key with HYPE (Network shows its balance).', hash: '' };
  if (/token|arena/i.test(problem)) return { text: 'Check the arenas and the game token in Setup.', hash: '#setup' };
  return null;
}

/** Game → bots: per room kind on/off, cap, minimum, target and difficulty mix, testnet staked bots, and the live count. */
export function BotsCard({ ctx, arenaIds }: { ctx: ChainCtx; arenaIds: number[] }) {
  const [view, setView] = useState<BotAdminView | null>(null);
  const [draft, setDraft] = useState<BotAdminView['settings'] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!ctx.api) return;
    ctx.api.bots().then(
      (v) => {
        setView(v);
        setDraft(structuredClone(v.settings));
        setState('ok');
      },
      (e) => {
        if (e instanceof SiteApiError && e.status === 404) setState('missing');
        else {
          setState('error');
          setErr((e as Error).message);
        }
      },
    );
  }, [ctx.api]);
  useEffect(load, [load]);
  // live counts refresh while the drawer is open
  useEffect(() => {
    if (!ctx.api || state !== 'ok') return;
    const id = window.setInterval(() => ctx.api!.bots().then((v) => setView((cur) => (cur ? { ...cur, live: v.live, stakedActive: v.stakedActive } : v)), () => {}), 15_000);
    return () => clearInterval(id);
  }, [ctx.api, state]);

  if (!ctx.api) return <Card title="Bots" id="bots" tone="quiet" lede="Sign in as the admin (top right) to see and change the bots." />;
  if (state === 'missing') return <Card title="Bots" id="bots" tone="quiet" lede="This server has no bot settings route yet (/api/admin/bots). Update the game server." />;
  if (!view || !draft) return <Card title="Bots" id="bots" tone="quiet" lede={state === 'error' ? `Cannot load the bots: ${err}` : 'Loading the bots…'} />;

  const patch = botsPatch(view.settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const setKind = (kind: string, p: Partial<BotKindSettings>) => setDraft({ ...draft, kinds: { ...draft.kinds, [kind]: { ...draft.kinds[kind], ...p } } });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const v = await ctx.api!.saveBots(patch);
      setView(v);
      setDraft(structuredClone(v.settings));
      setMsg('Bots saved: every room follows at once.');
    } catch (e) {
      const f = e instanceof SiteApiError && e.field ? ` (${e.field})` : '';
      setErr(`${(e as Error).message}${f}`);
    } finally {
      setBusy(false);
    }
  };
  const tot = view.live.totals;
  const ids = [...new Set([...arenaIds, ...Object.keys(draft.testnet.arenas).map(Number)])].sort((a, b) => a - b);
  const levels = Object.keys(Object.values(draft.kinds)[0]?.mix ?? { easy: 1, medium: 1, hard: 1 });

  return (
    <Card
      title="Bots"
      id="bots"
      kicker={tot ? `${tot.bots} bots · ${tot.humans} people · ${tot.rooms} rooms` : undefined}
      lede="Bots fill quiet rooms and always wear a BOT tag. When a person joins a full room, a bot goes home to make the seat. Off testnet bots are worth nothing; they never buy tickets."
    >
      <div className="ad-tablewrap">
        <table className="ad-table ad-bots" data-testid="bots-table">
          <thead>
            <tr>
              <th scope="col">Rooms</th>
              <th scope="col">On</th>
              <th scope="col" className="is-num">Cap</th>
              <th scope="col" className="is-num">Min</th>
              <th scope="col" className="is-num">Target</th>
              {levels.map((l) => (
                <th key={l} scope="col" className="is-num">
                  {l}
                </th>
              ))}
              <th scope="col" className="is-num">Bots / all</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft.kinds).map(([kind, k]) => {
              const live = view.live.byKind?.[kind];
              return (
                <tr key={kind} data-kind={kind}>
                  <td>
                    <strong>{kindLabel(kind)}</strong>
                  </td>
                  <td>
                    <label className="ad-switch ad-switch--inline">
                      <input type="checkbox" role="switch" checked={k.enabled} onChange={() => setKind(kind, { enabled: !k.enabled })} aria-label={`${kindLabel(kind)} bots on`} />
                    </label>
                  </td>
                  <td className="is-num">
                    <NumCell value={k.cap} max={64} label={`${kind} cap`} onChange={(n) => setKind(kind, { cap: n, min: Math.min(k.min, n) })} />
                  </td>
                  <td className="is-num">
                    <NumCell value={k.min} max={k.cap} label={`${kind} min`} onChange={(n) => setKind(kind, { min: n })} />
                  </td>
                  <td className="is-num">
                    <NumCell value={k.target} max={200} label={`${kind} target`} onChange={(n) => setKind(kind, { target: n })} />
                  </td>
                  {levels.map((l) => (
                    <td key={l} className="is-num">
                      <NumCell value={k.mix[l] ?? 0} max={100} label={`${kind} ${l}`} onChange={(n) => setKind(kind, { mix: { ...k.mix, [l]: n } })} />
                    </td>
                  ))}
                  <td className="num is-num">{live ? `${live.bots} / ${live.humans + live.bots}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {view.staked?.problem && (
        <div className="ad-blocked ad-bots__problem" role="alert" data-testid="bots-problem">
          <strong>STAKED BOTS STUCK.</strong>
          <p>{view.staked.problem}</p>
          {(() => {
            const fix = stakedFix(view.staked.problem);
            return fix ? (
              <p>
                <b>Fix:</b> {fix.text}{' '}
                <a href={`/admin${fix.hash}`} onClick={() => (location.hash = fix.hash)}>
                  Go there →
                </a>
              </p>
            ) : null;
          })()}
        </div>
      )}
      {view.testnet && (
        <div className="ad-bots__staked" data-testid="bots-staked">
          <h3 className="ad-h3">
            Testnet staked bots {view.stakedActive ? <span className="ad-code mono is-ok">running</span> : <span className="ad-code mono">not running</span>}
            {view.staked && (
              <span className="ad-dim num">
                {' '}
                · {view.staked.wallets} wallets · {view.staked.playing} tickets in play
              </span>
            )}
          </h3>
          <p className="ad-card__lede">They buy real testnet tickets with their own wallets: eat one and its tokens are yours. Funded from the server key (a TestToken minter).</p>
          <div className="ad-form2 ad-form3">
            <label className="ad-field">
              <span className="ad-field__label mono">Per arena</span>
              <NumCell value={draft.testnet.stakedPerArena} max={32} label="Staked bots per arena" onChange={(n) => setDraft({ ...draft, testnet: { ...draft.testnet, stakedPerArena: n } })} />
            </label>
            <label className="ad-field">
              <span className="ad-field__label mono">Bankroll (tELYMUM)</span>
              <input className="ad-input num" value={draft.testnet.bankroll} onChange={(e) => setDraft({ ...draft, testnet: { ...draft.testnet, bankroll: e.target.value.trim() } })} />
            </label>
            <label className="ad-field">
              <span className="ad-field__label mono">Gas per bot (HYPE)</span>
              <input className="ad-input num" value={draft.testnet.gasHype} onChange={(e) => setDraft({ ...draft, testnet: { ...draft.testnet, gasHype: e.target.value.trim() } })} />
            </label>
          </div>
          {ids.length > 0 && (
            <div className="ad-arenachips">
              <span className="ad-switchrow__label mono">Per arena</span>
              {ids.map((id) => {
                const a = draft.testnet.arenas[String(id)] ?? {};
                return (
                  <label key={id} className="ad-botarena">
                    <span className="num">#{id}</span> {arenaName(id)}
                    <NumCell
                      value={a.stakedBots ?? draft.testnet.stakedPerArena}
                      max={32}
                      label={`Staked bots in arena ${id}`}
                      onChange={(n) => setDraft({ ...draft, testnet: { ...draft.testnet, arenas: { ...draft.testnet.arenas, [String(id)]: { ...a, stakedBots: n } } } })}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view.live.rooms.length > 0 && (
        <details className="ad-rooms">
          <summary className="mono">Live rooms ({view.live.rooms.length})</summary>
          <ul className="ad-rooms__list">
            {view.live.rooms.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span className="num ad-dim">
                  {r.humans} people · {r.bots} bots{r.stakedBots ? ` (${r.stakedBots} staked)` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="ad-actions">
        <Btn sun disabled={!dirty || busy} onClick={() => void save()} testId="bots-save">
          {busy ? 'Saving…' : 'Save bots'}
        </Btn>
        {dirty && <Btn onClick={() => setDraft(structuredClone(view.settings))}>Undo</Btn>}
        {msg && !dirty && <span className="ad-note">{msg}</span>}
      </div>
      <FormError error={err} />
    </Card>
  );
}

/**
 * `/admin → Game`: the owner's decisions first (who may play, the pause, each arena open or
 * closed, the bots), then the arena contract's status; its manual controls sit under Advanced.
 */
export function GameTab({ ctx }: { ctx: ChainCtx }) {
  const arenaIds = (ctx.status?.arena?.arenas ?? []).map((a) => a.id);
  return (
    <div className="ad-game">
      <StartStopCard ctx={ctx} />
      <BotsCard ctx={ctx} arenaIds={arenaIds.length ? arenaIds : [1, 2, 3, 4]} />
      <CustomRoomsCard ctx={ctx} />
      <h2 className="ad-h3 ad-section-h">The arena contract</h2>
      <ArenaTab ctx={ctx} />
    </div>
  );
}
