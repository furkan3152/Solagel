import { createArenaCall, deployArenaParams, formatHypeAmount, rescueCall, setFeeBpsCall, setFeeWalletCall, setServerAuthorityCall, sweepArenaCall, updateArenaFrom } from '@elymum/sdk';
import {
  SWEEP_WARNING,
  arenaName,
  createArenaRefusal,
  fmtPct,
  fmtTok,
  parseAddressInput,
  parseBigIntInput,
  parseHypeInput,
  parseIntInput,
  parseTokenInput,
  sweepArenaRefusal,
  updateArenaRefusal,
} from '@elymum/sdk/ops';
import { sameAddress } from '@elymum/sdk';
import { useState } from 'react';
import type { Address } from 'viem';
import { DefaultArenas, SetTokenForm } from './DeployTab';
import { arenaDeployArgs, saveLocalDeploy } from './deploy';
import type { Plan } from './plan';
import { Addr, Advanced, Btn, Card, FormError, Input, Row, useFormError, type ChainCtx } from './ui';

/**
 * `/admin → Game → the arena contract`: its status, the settler fix when it is not this server's
 * key (one click, the key comes from the server), and every manual control (token, arenas, fee and
 * fee wallet, sweeps, rescue) under one collapsed Advanced section, prefilled. The pause and the
 * per-arena open / close are on Start / stop above.
 */
export function ArenaTab({ ctx }: { ctx: ChainCtx }) {
  const arena = ctx.net.arenaAddress;
  const a = ctx.status?.arena ?? null;
  const cfg = a?.config ?? null;
  if (!arena) return <Card title="No arena yet" id="arena" tone="quiet" lede="Deploy ElymumArena first (Setup)." />;
  if (!a || !cfg)
    return (
      <Card
        title={a?.code === 'missing' || a?.code === 'mismatch' ? 'That is not our arena' : 'Reading the arena…'}
        id="arena"
        tone={a?.code === 'missing' || a?.code === 'mismatch' ? 'danger' : 'quiet'}
        lede={a?.code === 'missing' ? 'No code at the registered arena address.' : a?.code === 'mismatch' ? 'The code at the registered address is not the bundled ElymumArena.' : 'One moment: asking the chain.'}
      />
    );
  const open = (title: string, call: Plan['call'], extra: Partial<Plan> = {}) =>
    ctx.open({ title, contract: 'ElymumArena', call, ownerOf: arena, owner: cfg.admin, onDone: () => ctx.refresh(), ...extra });
  const d = cfg.decimals;
  const sym = a.token?.symbol ? ` ${a.token.symbol}` : '';
  const serverMismatch = !!ctx.net.serverKey && !sameAddress(ctx.net.serverKey, cfg.serverAuthority);

  return (
    <div className="ad-arena">
      <Card
        title="Arena status"
        id="arena-status"
        aside={cfg.paused ? <span className="ad-code mono is-bad">Paused</span> : <span className="ad-code mono is-ok">Taking joins</span>}
      >
        <div className="ad-stats ad-stats--4">
          <div>
            <span className="mono">Tickets</span>
            <strong className="num">{cfg.totals.sessions.toString()}</strong>
          </div>
          <div>
            <span className="mono">Staked</span>
            <strong className="num">{fmtTok(cfg.totals.staked, d)}</strong>
          </div>
          <div>
            <span className="mono">Paid out</span>
            <strong className="num">{fmtTok(cfg.totals.paidOut, d)}</strong>
          </div>
          <div>
            <span className="mono">Fees · burned</span>
            <strong className="num">
              {fmtTok(cfg.totals.fees, d)} <small>· {fmtTok(cfg.totals.burned, d)}</small>
            </strong>
          </div>
        </div>
        <dl className="ad-kv">
          <Row label="Contract">
            <Addr value={arena} net={ctx.net} /> <span className={`ad-code mono${a.code === 'ok' ? ' is-ok' : ' is-bad'}`}>{a.code === 'ok' ? 'code hash ok' : `code ${a.code}`}</span>
            {a.version === 1 && <span className="ad-code mono is-bad">legacy v1 · fee on profit</span>}
            {a.version === 2 && <span className="ad-code mono is-ok">v2 · fee on entry</span>}
          </Row>
          <Row label="Owner">
            <Addr value={cfg.admin} net={ctx.net} />
            {cfg.pendingAdmin && (
              <>
                {' '}
                · pending <Addr value={cfg.pendingAdmin} net={ctx.net} />
              </>
            )}
          </Row>
          <Row label="Server authority">
            <Addr value={cfg.serverAuthority} net={ctx.net} />
            {a.serverBalance !== null && <span className="ad-role num">{formatHypeAmount(a.serverBalance, 4)} for gas</span>}
            {a.serverBalance === 0n && <span className="ad-bad"> no HYPE for gas: settlements cannot be sent</span>}
            {serverMismatch && <span className="ad-bad"> not this server's key ({ctx.net.serverKey})</span>}
          </Row>
          <Row label="Fee wallet">
            <Addr value={cfg.feeWallet} net={ctx.net} />
            {a.token && (
              <span className="ad-role num">
                holds {fmtTok(a.token.feeWalletBalance, d)}
                {sym}
              </span>
            )}
          </Row>
          <Row label="Fee">
            <span className="num">{cfg.feeBps} bps</span>{' '}
            <span className="ad-role">{a.version === 1 ? `${fmtPct(cfg.feeBps)} of profit (legacy v1 arena)` : `${fmtPct(cfg.feeBps)} of every played entry fee`}</span>
          </Row>
          <Row label="Paused">{cfg.paused ? <strong className="ad-bad">PAUSED: joins blocked</strong> : 'no'}</Row>
          <Row label="Token">{cfg.token ? <><Addr value={cfg.token} net={ctx.net} /> <span className="ad-role num">{d} decimals{sym}</span></> : <span className="ad-none">not set</span>}</Row>
        </dl>
        {a.arenas.length > 0 && (
          <div className="ad-tablewrap">
            <table className="ad-table">
              <caption className="mono">The four places</caption>
              <thead>
                <tr>
                  <th scope="col">Arena</th>
                  <th scope="col" className="is-num">Entry fee</th>
                  <th scope="col">State</th>
                  <th scope="col" className="is-num">Open tickets</th>
                  <th scope="col" className="is-num">Vault</th>
                  <th scope="col" className="is-num">Owed</th>
                </tr>
              </thead>
              <tbody>
                {a.arenas.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <span className="num ad-dim">#{x.id}</span> <strong>{arenaName(x.id)}</strong>
                    </td>
                    <td className="num is-num">
                      {fmtTok(x.entryFee, d)}
                      {sym}
                    </td>
                    <td>{x.enabled ? <span className="ad-code mono is-ok">enabled</span> : <span className="ad-code mono is-bad">disabled</span>}</td>
                    <td className="num is-num">
                      {x.openSessions} <span className="ad-dim">/ {x.maxSessions}</span>
                    </td>
                    <td className="num is-num">{fmtTok(x.vault, d)}</td>
                    <td className="num is-num">{fmtTok(x.owed, d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {a.version === 1 && <LegacyArenaCard ctx={ctx} />}
      {serverMismatch && <SwitchCard ctx={ctx} open={open} serverMismatch={serverMismatch} />}
      <Advanced title="Advanced: arena contract controls" testId="arena-advanced" section>
        <div className="ad-mint__forms">
          <SetTokenForm ctx={ctx} />
          <FeeCard ctx={ctx} open={open} />
        </div>
        <DefaultArenas ctx={ctx} />
        {cfg.token && <ArenaEdit ctx={ctx} open={open} />}
        <h2 className="ad-zone mono">The red switches</h2>
        <div className="ad-mint__forms">
          {cfg.token && <SweepCard ctx={ctx} open={open} />}
          <RescueCard ctx={ctx} open={open} />
        </div>
      </Advanced>
    </div>
  );
}

type OpenFn = (title: string, call: Plan['call'], extra?: Partial<Plan>) => void;

/**
 * The registered arena is the legacy v1 build (fee on profit). The fee rule lives in the contract's code, so the
 * only way to the fee-on-entry rule is a new arena: what a redeploy means, step by step.
 */
function LegacyArenaCard({ ctx }: { ctx: ChainCtx }) {
  const [err, guard, setErr] = useFormError();
  const [done, setDone] = useState<string | null>(null);
  const deploy = () =>
    guard(() => {
      const params = deployArenaParams(arenaDeployArgs(ctx.me, ctx.net.serverKey));
      ctx.open({
        title: 'Deploy the new ElymumArena (v2: fee on entry)',
        contract: 'ElymumArena',
        deploy: { name: 'ElymumArena', params },
        onDone: async ({ address, hash }) => {
          if (!address || !ctx.net.info) return;
          saveLocalDeploy(ctx.net.info.id, 'arena', { address, txHash: hash });
          if (!ctx.api) {
            setDone(`Deployed at ${address}. Sign in as the admin, then register it (Setup → Register a contract that is already deployed).`);
            return;
          }
          try {
            await ctx.api.registerContract({ kind: 'arena', address, txHash: hash });
            setDone(`New arena ${address} registered: set the game token and create the arenas (Setup).`);
            await ctx.reloadNet();
            await ctx.refresh();
          } catch (e) {
            setErr(`Deployed at ${address}, but the server did not switch yet: ${(e as Error).message} Register it later (Setup → Register a contract that is already deployed).`);
          }
        },
      });
    });
  return (
    <Card
      title="This arena takes the fee on profit (legacy v1)"
      id="arena-legacy"
      tone="danger"
      lede="The new fee rule (the fee comes off every played entry fee, win or lose; unplayed tickets are refunded in full) needs the new ElymumArena contract. It cannot be switched on this one: redeploy the arena to migrate."
    >
      <ol className="ad-steps">
        <li>Close every arena here (Start / stop) and wait until every open ticket is settled (the open-ticket column at 0; unplayed tickets are refunded by the server within about 15 minutes).</li>
        <li>Still on this (old) arena: sweep each disabled arena's vault to the fee wallet (Advanced → sweep). What is left there is loot dust and rounding; payouts waiting to be collected stay reserved for their players and remain collectable on the old address.</li>
        <li>Deploy the new arena (the button below, the bundled v2 contract; it gets a NEW address). It registers with the server by itself: the server switches only when its journal owes nothing on the old arena (step 1) and reads the new fee rule by itself.</li>
        <li>Setup: set the same game token on the new arena, create the four arenas, set the holder perks (and holders-only #4) and, if wanted, the fee wallet again.</li>
        <li>On testnet, the staked bots buy their tickets on the new arena by themselves: no re-funding needed (their wallets keep their tokens; the bankroll is minted again when low).</li>
        <li>If the server has ARENA_ADDRESS set (Render), it overrides the registry: change it to the new address instead.</li>
      </ol>
      <Btn sun icon="arrow" onClick={deploy} testId="redeploy-arena">
        Preview the new arena deploy
      </Btn>
      {done && (
        <p className="ad-ok" role="status">
          {done}
        </p>
      )}
      <FormError error={err} />
    </Card>
  );
}

function ArenaEdit({ ctx, open }: { ctx: ChainCtx; open: OpenFn }) {
  const a = ctx.status!.arena!;
  const cfg = a.config!;
  const arena = ctx.net.arenaAddress!;
  const [id, setId] = useState(String(a.arenas[0]?.id ?? 5));
  const [fee, setFee] = useState('');
  const [max, setMax] = useState('300');
  const [enabled, setEnabled] = useState(true);
  const [err, guard] = useFormError();
  const existing = a.arenas.filter((x) => x.exists).map((x) => x.id);
  const sym = a.token?.symbol ?? '';
  return (
    <Card title="Create or update an arena" id="arena-edit" lede="Updating writes every field; the entry fee changes only while no ticket is open.">
      <div className="ad-form ad-form--grid ad-form--3">
        <Input label="Arena id" value={id} onChange={setId} />
        <Input label="Entry fee (whole tokens)" suffix={sym.trim() || undefined} value={fee} onChange={setFee} placeholder="1000" />
        <Input label="Max open tickets" value={max} onChange={setMax} />
      </div>
      <label className="ad-check">
        <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} />
        <span>
          Enabled <span className="ad-check__sub">Update only. A disabled arena takes no new tickets.</span>
        </span>
      </label>
      <div className="ad-actions">
        <Btn
          onClick={() =>
            guard(() => {
              const p = { id: parseIntInput('Arena id', id, 1, 65_535), entryFee: parseTokenInput('Entry fee', fee, cfg.decimals), maxSessions: parseIntInput('Max open tickets', max, 2, 2000) };
              const r = createArenaRefusal(cfg, p, existing);
              if (r) throw new Error(r);
              open(`Create arena #${p.id}`, createArenaCall(arena, p));
            })
          }
        >
          Preview create
        </Btn>
        <Btn
          onClick={() =>
            guard(() => {
              const n = parseIntInput('Arena id', id, 1, 65_535);
              const cur = a.arenas.find((x) => x.id === n);
              if (!cur) throw new Error(`arena #${n} does not exist`);
              const entryFee = fee.trim() ? parseTokenInput('Entry fee', fee, cfg.decimals) : cur.entryFee;
              const r = updateArenaRefusal(cur, entryFee);
              if (r) throw new Error(r);
              open(`Update arena #${n}`, updateArenaFrom(arena, cur, { entryFee, maxSessions: parseIntInput('Max open tickets', max, 2, 2000), enabled }));
            })
          }
        >
          Preview update
        </Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function FeeCard({ ctx, open }: { ctx: ChainCtx; open: OpenFn }) {
  const cfg = ctx.status!.arena!.config!;
  const legacy = ctx.status!.arena!.version === 1;
  const arena = ctx.net.arenaAddress!;
  const [bps, setBps] = useState(String(cfg.feeBps));
  const [wallet, setWallet] = useState<string>(cfg.feeWallet);
  const [err, guard] = useFormError();
  return (
    <Card
      title="Fee"
      id="arena-config"
      kicker={`Now ${cfg.feeBps} bps`}
      lede={
        legacy
          ? 'This legacy (v1) arena takes the fee from profit only. Redeploy the arena to take it from every entry. At most 1000 bps (10 %).'
          : 'Taken from the entry fee of every played ticket, win or lose (an unplayed ticket is refunded in full). New tickets only; open ones keep their rate. At most 1000 bps (10 %).'
      }
    >
      <div className="ad-inlineform">
        <Input
          label={legacy ? 'Fee on profit' : 'Fee on each entry'}
          suffix="bps"
          value={bps}
          onChange={setBps}
          hint={`${(Number(bps) / 100 || 0).toFixed(2)} % of ${legacy ? 'profit' : 'the entry fee'}`}
        />
        <Btn onClick={() => guard(() => open('Set the fee', setFeeBpsCall(arena, parseIntInput('Fee (bps)', bps, 0, 1000))))}>Preview fee</Btn>
      </div>
      <div className="ad-inlineform">
        <Input label="Fee wallet" value={wallet} onChange={setWallet} />
        <Btn onClick={() => guard(() => open('Set the fee wallet', setFeeWalletCall(arena, parseAddressInput('Fee wallet', wallet))))}>Preview fee wallet</Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function SwitchCard({ ctx, open, serverMismatch }: { ctx: ChainCtx; open: OpenFn; serverMismatch: boolean }) {
  const cfg = ctx.status!.arena!.config!;
  const arena = ctx.net.arenaAddress!;
  return (
    <Card title="The settler" id="arena-switches" tone="danger" lede="The settler is the key that pays out rounds. It must be this game server's key.">
      <div className="ad-dangerrow">
        <p>
          <strong>Server authority.</strong> {serverMismatch ? 'It is not this server’s key: rounds cannot settle.' : 'It is this server’s key. Nothing to do.'}
        </p>
        <Addr value={ctx.net.serverKey} net={ctx.net} />
        <Btn
          danger={serverMismatch}
          disabled={!serverMismatch || !ctx.net.serverKey}
          testId="arena-server-key"
          onClick={() => ctx.net.serverKey && open("Make this server's key the settler", setServerAuthorityCall(arena, ctx.net.serverKey as Address))}
        >
          Server authority = this server&apos;s key
        </Btn>
      </div>
    </Card>
  );
}

function SweepCard({ ctx, open }: { ctx: ChainCtx; open: OpenFn }) {
  const a = ctx.status!.arena!;
  const arena = ctx.net.arenaAddress!;
  const [id, setId] = useState('');
  const [err, guard] = useFormError();
  return (
    <Card title="Sweep a closed arena" id="arena-sweep" tone="danger" lede={SWEEP_WARNING}>
      <Input label="Arena id (disabled, no open tickets)" value={id} onChange={setId} />
      <Btn
        danger
        onClick={() =>
          guard(() => {
            const n = parseIntInput('Arena id', id, 1, 65_535);
            const cur = a.arenas.find((x) => x.id === n) ?? { id: n, exists: false, enabled: false, openSessions: 0 };
            const r = sweepArenaRefusal(cur);
            if (r) throw new Error(r);
            open(`Sweep arena #${n} to the fee wallet`, sweepArenaCall(arena, n), { confirmText: `SWEEP ${n}`, note: SWEEP_WARNING });
          })
        }
      >
        Preview sweep
      </Btn>
      <FormError error={err} />
    </Card>
  );
}

function RescueCard({ ctx, open }: { ctx: ChainCtx; open: OpenFn }) {
  const arena = ctx.net.arenaAddress!;
  const [token, setToken] = useState('');
  const [to, setTo] = useState<string>(ctx.me ?? '');
  const [amount, setAmount] = useState('');
  const [err, guard] = useFormError();
  return (
    <Card title="Rescue" id="arena-rescue" tone="danger" lede="Recovers HYPE (leave the token empty) or a foreign ERC-20 sent to the arena by mistake. Never the game token.">
      <div className="ad-form">
        <Input label="Token (empty = HYPE)" value={token} onChange={setToken} placeholder="0x… or empty" />
        <Input label="To" value={to} onChange={setTo} />
        <Input label={token.trim() ? 'Amount (base units)' : 'Amount (HYPE)'} value={amount} onChange={setAmount} />
      </div>
      <Btn
        onClick={() =>
          guard(() => {
            const t = token.trim() ? parseAddressInput('Token', token) : null;
            const cfg = ctx.status?.arena?.config;
            if (t && cfg?.token && sameAddress(t, cfg.token)) throw new Error('The game token can never be rescued.');
            const value = t ? parseBigIntInput('Amount', amount, 1n) : parseHypeInput('Amount', amount);
            open('Rescue funds from the arena', rescueCall(arena, { token: t, to: parseAddressInput('To', to), amount: value }));
          })
        }
      >
        Preview rescue
      </Btn>
      <FormError error={err} />
    </Card>
  );
}
