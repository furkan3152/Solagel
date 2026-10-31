import { formatHypeAmount } from '@elymum/sdk';
import { checkDeployedCode, type CodeCheck, type StatusSnapshot } from '@elymum/sdk/ops';
import { CONTRACT_KINDS, type ContractKind, type ContractsRegistry, type NetworkInfo } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { parseEther, type Address } from 'viem';
import { HYPE_FAUCET_URL } from '../site/faucet/logic';
import { NetPill } from './NetPill';
import type { AdminNetwork } from './net';
import { Addr, Btn, Card, Input, Mark, Row, type ChainCtx } from './ui';

/** Below this the server key gets a "fund it" hint (a settlement costs a little gas). */
export const LOW_SERVER_HYPE = 10n ** 16n; // 0.01 HYPE

export interface MainnetStep {
  id: string;
  label: string;
  detail: string;
  /** null: cannot be checked from here (or not on mainnet yet). */
  ok: boolean | null;
  /** The drawer that does it. */
  where: 'Render' | 'Setup' | 'Mint' | 'Game' | 'Community';
}

/**
 * The mainnet launch, in order, with the exact steps (pure, tested). On a testnet every step is
 * still to do (they are checked once the server follows the mainnet RPC).
 */
export function mainnetChecklist(net: AdminNetwork, status: StatusSnapshot | null): MainnetStep[] {
  const on = net.mainnet;
  const a = status?.arena ?? null;
  const cfg = a?.config ?? null;
  const nft = status?.nft?.state ?? null;
  const when = (v: boolean | null | undefined): boolean | null => (on ? (v ?? null) : false);
  return [
    { id: 'rpc', label: 'Set EVM_RPC_URL in Render to the Elysium mainnet RPC', detail: 'Render → the game service → Environment → EVM_RPC_URL, then redeploy. The server follows that chain; testnet records stay on file.', ok: on, where: 'Render' },
    { id: 'access', label: 'Set Game access explicitly', detail: 'The site settings carry over from testnet (where the game is public): pick Admins or Holders in Game before anything else opens.', ok: null, where: 'Game' },
    { id: 'fund', label: 'Fund the server key with HYPE', detail: 'It sends every settlement. Half a HYPE lasts a long time.', ok: when(a?.serverBalance != null ? a.serverBalance >= LOW_SERVER_HYPE : null), where: 'Render' },
    { id: 'arena', label: 'Deploy ElymumArena from the owner wallet and register it', detail: 'Setup → Arena step. The server checks the code hash, the owner and the settler.', ok: when(!!net.arenaAddress && a?.code === 'ok'), where: 'Setup' },
    { id: 'nft', label: 'Deploy ElymumNFT from the owner wallet and register it', detail: 'Setup → NFT step.', ok: when(!!net.nftAddress && status?.nft?.code === 'ok'), where: 'Setup' },
    { id: 'token', label: 'Set the game token ($ELYMUM) on the arena', detail: 'Once, and only the real token: there is no TestToken on mainnet.', ok: when(cfg ? !!cfg.token : null), where: 'Setup' },
    { id: 'arenas', label: 'Create the arenas, the holder perks and the holders-only Isles', detail: 'Setup → the four arenas, then holder perks (NFT + 3% fee) and #4 holders-only.', ok: when(cfg ? (a?.arenas.length ?? 0) >= 4 && !!cfg.holderNft : null), where: 'Setup' },
    { id: 'allowlist', label: 'Build the mainnet allowlist and publish its root', detail: 'Import the testnet holders into the WL first (Mint), then build and publish.', ok: when(nft ? nft.root !== `0x${'0'.repeat(64)}` : null), where: 'Mint' },
    { id: 'mint', label: 'Open the mint (Allowlist, then Public)', detail: 'Mint → the phase switch.', ok: when(nft ? nft.phaseName !== 'closed' : null), where: 'Mint' },
    { id: 'game', label: 'Open the game', detail: 'Game → who may play: holders, then everyone when you are ready.', ok: null, where: 'Game' },
  ];
}

interface RpcHealth {
  ok: boolean;
  block: bigint | null;
  ms: number | null;
  error: string | null;
}

/** `/admin → Network`: the chain, the RPC, the server key, the contracts and the mainnet launch steps. */
export function NetworkTab({ ctx, registry }: { ctx: ChainCtx; registry: ContractsRegistry | null }) {
  const { net, client, status } = ctx;
  const [rpc, setRpc] = useState<RpcHealth | null>(null);
  const [keyWei, setKeyWei] = useState<bigint | null>(null);
  const [codes, setCodes] = useState<Partial<Record<ContractKind, CodeCheck | null>>>({});
  // the server's own view (`GET /api/admin/network`): its RPC, its key, its code checks
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [fundText, setFundText] = useState('1');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!ctx.api?.network) return;
    let live = true;
    ctx.api.network().then(
      (n) => live && setInfo(n),
      () => {},
    );
    void reload;
    return () => {
      live = false;
    };
  }, [ctx.api, status, reload]);

  // RPC health: one timed block read
  useEffect(() => {
    if (!client) {
      setRpc(null);
      return;
    }
    let live = true;
    const t0 = performance.now();
    client.getBlockNumber().then(
      (block) => live && setRpc({ ok: true, block, ms: Math.round(performance.now() - t0), error: null }),
      (e: Error) => live && setRpc({ ok: false, block: null, ms: null, error: e.message?.split('\n')[0] ?? 'unreachable' }),
    );
    if (net.serverKey) client.getBalance({ address: net.serverKey }).then((b) => live && setKeyWei(b), () => {});
    return () => {
      live = false;
    };
  }, [client, net.serverKey, status]);

  // the code hash of every registered contract
  useEffect(() => {
    if (!client || !registry) return;
    let live = true;
    for (const kind of CONTRACT_KINDS) {
      const r = registry[kind];
      if (!r) continue;
      checkDeployedCode(client, r.address as Address, kind).then(
        (c) => live && setCodes((x) => ({ ...x, [kind]: c })),
        () => live && setCodes((x) => ({ ...x, [kind]: null })),
      );
    }
    return () => {
      live = false;
    };
  }, [client, registry]);

  const steps = mainnetChecklist(net, status);
  const serverWei = info?.serverBalanceWei != null ? BigInt(info.serverBalanceWei) : keyWei;
  const low = info ? info.low : keyWei !== null && keyWei < LOW_SERVER_HYPE;
  const health: RpcHealth | null = info ? { ok: info.rpcOk, block: info.block !== null ? BigInt(info.block) : null, ms: info.rpcLatencyMs, error: info.rpcOk ? null : 'the server cannot reach its RPC' } : rpc;
  const codeOf = (kind: ContractKind) => {
    const c = info?.contracts.find((x) => x.kind === kind);
    return c ? c.code : codes[kind];
  };
  const NAMES: Record<ContractKind, string> = { arena: 'ElymumArena', nft: 'ElymumNFT', token: 'Game token / TestToken' };

  return (
    <div className="ad-network">
      <Card title="The chain" id="net-chain" aside={<NetPill net={net} />}>
        <dl className="ad-kv">
          <Row label="Chain">{net.info ? <span className="num">{`${net.info.name} (${net.info.id})`}</span> : <span className="ad-bad">none: EVM_RPC_URL is unset</span>}</Row>
          <Row label="RPC">
            {net.info?.rpcUrl ? <code className="ad-addr__v">{net.info.rpcUrl}</code> : <span className="ad-none">the wallet&apos;s own</span>}{' '}
            {health &&
              (health.ok ? (
                <span className="ad-code mono is-ok" data-testid="rpc-health">
                  ok · block {health.block?.toString()} · {health.ms} ms
                </span>
              ) : (
                <span className="ad-code mono is-bad" data-testid="rpc-health">
                  down · {health.error}
                </span>
              ))}
          </Row>
          <Row label="Explorer">{net.info?.explorerUrl ? <a href={net.info.explorerUrl} target="_blank" rel="noreferrer">{net.info.explorerUrl}</a> : <span className="ad-none">none</span>}</Row>
        </dl>
      </Card>

      <Card title="Server key" id="net-key" lede="The game server's own key: it settles every round on the arena, so it pays the gas in HYPE.">
        <dl className="ad-kv">
          <Row label="Address">
            <Addr value={net.serverKey} net={net} />
          </Row>
          <Row label="Balance">
            {serverWei === null ? <span className="ad-none">…</span> : <span className={`num${low ? ' ad-bad' : ''}`}>{formatHypeAmount(serverWei, 4)}</span>}
          </Row>
        </dl>
        <FundServerKey
          ctx={ctx}
          text={fundText}
          setText={setFundText}
          onFunded={() => {
            setReload((n) => n + 1);
            void ctx.refresh();
          }}
        />
        {low && (
          <p className="ad-warn" data-testid="fund-hint">
            <strong>Fund it.</strong> Send HYPE to the address above (about 0.5 HYPE lasts a long time); without gas, settlements cannot be sent.
            {!net.mainnet && (
              <>
                {' '}
                On testnet:{' '}
                <a href={HYPE_FAUCET_URL} target="_blank" rel="noreferrer">
                  Kinetiq&apos;s HYPE faucet
                </a>
                .
              </>
            )}
          </p>
        )}
      </Card>

      <Card title="Contracts on this chain" id="net-contracts" lede="What the server has registered, each checked against the bundled code hash. Every chain keeps its own records.">
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Address</th>
                <th scope="col">Chain</th>
                <th scope="col">Code</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_KINDS.map((kind) => {
                const r = registry?.[kind] ?? null;
                const c = codeOf(kind);
                const other = r && net.info && r.chainId !== net.info.id;
                return (
                  <tr key={kind} data-kind={kind}>
                    <td>
                      <strong>{NAMES[kind]}</strong>
                    </td>
                    <td>{r ? <Addr value={r.address} net={net} /> : <span className="ad-none">not registered</span>}</td>
                    <td className="num">{r ? <span className={other ? 'ad-bad' : undefined}>{r.chainId}</span> : '—'}</td>
                    <td>{r ? c === undefined ? <span className="ad-none">…</span> : <span className={`ad-code mono${c === 'ok' ? ' is-ok' : ' is-bad'}`}>{c === 'ok' ? 'code hash ok' : `code ${c ?? 'unreadable'}`}</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {info && info.otherChains.length > 0 && (
          <p className="ad-note" data-testid="other-chains">
            Records kept for other chains: {info.otherChains.map((id) => (id === 99801 ? 'Elysium Testnet (99801)' : String(id))).join(', ')}. They come back if the server follows that chain again.
          </p>
        )}
      </Card>

      <Card
        title="Mainnet launch"
        id="net-mainnet"
        kicker={net.mainnet ? 'On mainnet' : 'Do these in order'}
        lede={net.mainnet ? 'The server follows mainnet. Each line turns green as it is done.' : 'The exact steps for launch day. Nothing here runs from testnet: the lines are checked once the server is on mainnet.'}
      >
        <ol className="ad-checks ad-mainnet-steps" data-testid="mainnet-checklist">
          {steps.map((s, i) => {
            const state = s.ok === true ? 'ok' : s.ok === false ? 'todo' : 'unknown';
            return (
              <li key={s.id} className={`ad-check-line is-${state}`} data-item={s.id}>
                <Mark state={state} />
                <span className="ad-check-line__label">
                  <span className="num ad-dim">{i + 1}.</span> {s.label}
                </span>
                <span className="ad-check-line__detail">
                  {s.detail} <span className="mono ad-dim">· {s.where}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

/**
 * "Send HYPE to the server key": a plain transfer from the connected wallet, shown in the transaction
 * preview first like every other write. 1 HYPE by default (it pays settlement gas and, on testnet,
 * the staked bots' gas).
 */
function FundServerKey({ ctx, text, setText, onFunded }: { ctx: ChainCtx; text: string; setText: (v: string) => void; onFunded: () => void }) {
  const to = ctx.net.serverKey as Address | null;
  let value: bigint | null = null;
  try {
    value = /^\d+(\.\d{1,18})?$/.test(text.trim()) ? parseEther(text.trim()) : null;
  } catch {
    value = null;
  }
  const bad = value === null || value <= 0n;
  const send = () => {
    if (!to || bad || value === null) return;
    ctx.open({
      title: 'Fund the server key',
      contract: 'Server key',
      transfer: { to, value },
      note: `Sends ${text.trim()} HYPE from your wallet to the game server's key. It pays settlement gas${ctx.net.mainnet ? '' : ' and the testnet bots\' gas'}.`,
      onDone: onFunded,
    });
  };
  return (
    <div className="ad-fund" data-testid="fund-server-key">
      <Input label="Send HYPE from your wallet" value={text} onChange={setText} suffix="HYPE" hint={bad ? 'Type an amount, e.g. 1 or 0.5.' : undefined} />
      <Btn sun icon="wallet" testId="fund-send" disabled={!to || bad || !ctx.me} onClick={send}>
        Send to server key
      </Btn>
      {!ctx.me && <span className="ad-note">Connect your wallet first.</span>}
      {!to && <span className="ad-note">The server has not published its key yet.</span>}
    </div>
  );
}
