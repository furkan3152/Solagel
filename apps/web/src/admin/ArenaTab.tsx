import { createArenaCall, formatHypeAmount, rescueCall, setFeeBpsCall, setFeeWalletCall, setPausedCall, setServerAuthorityCall, sweepArenaCall, updateArenaFrom } from '@elymum/sdk';
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
import type { Plan } from './plan';
import { Addr, Btn, Card, FormError, Input, Row, useFormError, type ChainCtx } from './ui';

/** `/admin → Arena`: the ElymumArena owner's controls (token, arenas, fee, pause, server key, sweeps, rescue). */
export function ArenaTab({ ctx }: { ctx: ChainCtx }) {
  const arena = ctx.net.arenaAddress;
  const a = ctx.status?.arena ?? null;
  const cfg = a?.config ?? null;
  if (!arena) return <Card title="Arena" id="arena" lede="Deploy and register the arena first (Deploy tab)."><></></Card>;
  if (!a || !cfg)
    return (
      <Card title="Arena" id="arena" lede={a?.code === 'missing' ? 'No code at the registered arena address.' : a?.code === 'mismatch' ? 'The code at the registered address is not the bundled ElymumArena.' : 'Reading the arena…'}>
        <></>
      </Card>
    );
  const open = (title: string, call: Plan['call'], extra: Partial<Plan> = {}) =>
    ctx.open({ title, contract: 'ElymumArena', call, ownerOf: arena, owner: cfg.admin, onDone: () => ctx.refresh(), ...extra });
  const d = cfg.decimals;
  const sym = a.token?.symbol ? ` ${a.token.symbol}` : '';
  const serverMismatch = !!ctx.net.serverKey && !sameAddress(ctx.net.serverKey, cfg.serverAuthority);

  return (
    <div className="ad-arena">
      <Card title="Arena status" id="arena-status">
        <dl className="ad-kv">
          <Row label="Contract">
            <Addr value={arena} net={ctx.net} /> · code {a.code}
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
            {a.serverBalance !== null && <span className="ad-note"> balance {formatHypeAmount(a.serverBalance, 4)}</span>}
            {a.serverBalance === 0n && <span className="ad-bad"> no HYPE for gas: settlements cannot be sent</span>}
            {serverMismatch && <span className="ad-bad"> not this server's key ({ctx.net.serverKey})</span>}
          </Row>
          <Row label="Fee wallet">
            <Addr value={cfg.feeWallet} net={ctx.net} />
            {a.token && (
              <span className="ad-note">
                {' '}
                holds {fmtTok(a.token.feeWalletBalance, d)}
                {sym}
              </span>
            )}
          </Row>
          <Row label="Fee">
            {cfg.feeBps} bps ({fmtPct(cfg.feeBps)} of profit)
          </Row>
          <Row label="Paused">{cfg.paused ? <strong className="ad-bad">PAUSED: joins blocked</strong> : 'no'}</Row>
          <Row label="Token">{cfg.token ? <><Addr value={cfg.token} net={ctx.net} /> · {d} decimals{sym}</> : 'not set'}</Row>
          <Row label="Totals">
            {cfg.totals.sessions.toString()} tickets · staked {fmtTok(cfg.totals.staked, d)} · paid {fmtTok(cfg.totals.paidOut, d)} · fees {fmtTok(cfg.totals.fees, d)} · burned {fmtTok(cfg.totals.burned, d)}
          </Row>
        </dl>
        {a.arenas.length > 0 && (
          <div className="ad-tablewrap">
            <table className="ad-table">
              <caption className="mono">Arenas</caption>
              <thead>
                <tr>
                  <th scope="col">Id</th>
                  <th scope="col">Entry fee</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Open</th>
                  <th scope="col">Vault</th>
                  <th scope="col">Owed</th>
                </tr>
              </thead>
              <tbody>
                {a.arenas.map((x) => (
                  <tr key={x.id}>
                    <td>
                      #{x.id} {arenaName(x.id)}
                    </td>
                    <td>
                      {fmtTok(x.entryFee, d)}
                      {sym}
                    </td>
                    <td>{x.enabled ? 'yes' : <strong>DISABLED</strong>}</td>
                    <td>
                      {x.openSessions} / {x.maxSessions}
                    </td>
                    <td>{fmtTok(x.vault, d)}</td>
                    <td>{fmtTok(x.owed, d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <SetTokenForm ctx={ctx} />
      <DefaultArenas ctx={ctx} />
      {cfg.token && <ArenaEdit ctx={ctx} open={open} />}
      <ConfigCard ctx={ctx} open={open} serverMismatch={serverMismatch} />
      {cfg.token && <SweepCard ctx={ctx} open={open} />}
      <RescueCard ctx={ctx} open={open} />
    </div>
  );
}

type OpenFn = (title: string, call: Plan['call'], extra?: Partial<Plan>) => void;

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
  return (
    <Card title="Create or update an arena" id="arena-edit" lede="Updating writes every field; the entry fee changes only while no ticket is open.">
      <div className="ad-form">
        <Input label="Arena id" value={id} onChange={setId} />
        <Input label="Entry fee (whole tokens)" value={fee} onChange={setFee} placeholder="1000" />
        <Input label="Max open tickets" value={max} onChange={setMax} />
        <label className="ad-check">
          <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} /> enabled (update only)
        </label>
      </div>
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

function ConfigCard({ ctx, open, serverMismatch }: { ctx: ChainCtx; open: OpenFn; serverMismatch: boolean }) {
  const cfg = ctx.status!.arena!.config!;
  const arena = ctx.net.arenaAddress!;
  const [bps, setBps] = useState(String(cfg.feeBps));
  const [wallet, setWallet] = useState<string>(cfg.feeWallet);
  const [err, guard] = useFormError();
  return (
    <Card title="Fee, pause and server key" id="arena-config">
      <Input label="Fee on profit (bps, at most 1000)" value={bps} onChange={setBps} />
      <Btn onClick={() => guard(() => open('Set the fee', setFeeBpsCall(arena, parseIntInput('Fee (bps)', bps, 0, 1000))))}>Preview fee</Btn>
      <Input label="Fee wallet" value={wallet} onChange={setWallet} />
      <Btn onClick={() => guard(() => open('Set the fee wallet', setFeeWalletCall(arena, parseAddressInput('Fee wallet', wallet))))}>Preview fee wallet</Btn>
      <div className="ad-actions">
        <Btn danger={!cfg.paused} testId="arena-pause" onClick={() => open(cfg.paused ? 'Resume arena joins' : 'Pause arena joins', setPausedCall(arena, !cfg.paused), { note: cfg.paused ? undefined : 'Pause blocks joins only; settlements and refunds keep working.' })}>
          {cfg.paused ? 'Resume joins' : 'Pause joins'}
        </Btn>
        <Btn
          disabled={!serverMismatch || !ctx.net.serverKey}
          testId="arena-server-key"
          onClick={() => ctx.net.serverKey && open("Make this server's key the settler", setServerAuthorityCall(arena, ctx.net.serverKey as Address))}
        >
          Server authority = this server's key
        </Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function SweepCard({ ctx, open }: { ctx: ChainCtx; open: OpenFn }) {
  const a = ctx.status!.arena!;
  const arena = ctx.net.arenaAddress!;
  const [id, setId] = useState('');
  const [err, guard] = useFormError();
  return (
    <Card title="Sweep a closed arena" id="arena-sweep" lede={SWEEP_WARNING}>
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
    <Card title="Rescue" id="arena-rescue" lede="Recovers HYPE (leave the token empty) or a foreign ERC-20 sent to the arena by mistake. Never the game token.">
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
