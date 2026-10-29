import { createArenaCall, deployArenaParams, deployNftParams, deployTestTokenParams, faucetCall, testTokenArtifact } from '@elymum/sdk';
import { checkDeployedCode, confirmTypedAddress, planDefaultArenas, setTokenRefusal, testTokenRefusal, arenaName, fmtTok } from '@elymum/sdk/ops';
import { setTokenCall } from '@elymum/sdk';
import type { ContractKind } from '@elymum/shared';
import { useEffect, useState } from 'react';
import type { Address, Hash } from 'viem';
import { describeError } from '@elymum/sdk';
import { ensureChain } from '../wallet/network';
import { connected } from '../wallet/store';
import { activeStep, arenaDeployArgs, defaultNftForm, deploySteps, loadLocalDeploys, nftDeployArgs, saveLocalDeploy, type LocalDeploys, type NftForm } from './deploy';
import { Icon } from '../design';
import { Addr, Btn, Card, FormError, Input, NeedsSession, Row, useFormError, type ChainCtx } from './ui';

/**
 * `/admin → Deploy`: the owner deploys everything from their own wallet (spec section 5). Each
 * deploy and call goes through the transaction preview; each new contract is registered with the
 * server (`POST /api/admin/contracts`), which checks its code hash, owner and server authority.
 */
export function DeployTab({ ctx }: { ctx: ChainCtx }) {
  const { net, status, me, walletChainId, api } = ctx;
  const chainId = net.info?.id ?? null;
  const [local, setLocal] = useState<LocalDeploys>(() => loadLocalDeploys(chainId));
  useEffect(() => setLocal(loadLocalDeploys(chainId)), [chainId]);
  const steps = deploySteps({ me, walletChainId, net, status, local });
  const active = activeStep(steps);

  const n = steps.findIndex((s) => s.state === 'active') + 1;
  const kicker = (i: number) => `Step ${i} of ${steps.length}`;

  return (
    <div className="ad-deploy">
      <aside className="ad-deploy__path" aria-label="Deploy steps">
        <ol className="ad-steps" data-testid="deploy-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`ad-step is-${s.state}`} data-step={s.id} data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
              <span className="ad-step__n num" aria-hidden="true">
                {s.state === 'done' ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <span className="ad-step__text">
                <strong className="ad-step__label">{s.label}</strong>
                <span className={`ad-step__detail${/0x[0-9a-fA-F]{8}/.test(s.detail) ? ' is-hex' : ''}`}>{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="ad-deploy__fine">Each new contract is owned by the wallet that deploys it. Nothing here uses a server key, except as the arena&apos;s settler.</p>
      </aside>
      <div className="ad-deploy__work">
        {active === 'connect' && <ConnectStep kicker={kicker(n)} />}
        {active === 'chain' && <ChainStep ctx={ctx} kicker={kicker(n)} />}
        {active === 'arena' && <ArenaStep ctx={ctx} onLocal={setLocal} kicker={kicker(n)} />}
        {active === 'nft' && <NftStep ctx={ctx} onLocal={setLocal} kicker={kicker(n)} />}
        {active === 'register' && <RegisterStep ctx={ctx} local={local} onLocal={setLocal} kicker={kicker(n)} />}
        {active === 'token' && <SetTokenForm ctx={ctx} kicker={kicker(n)} />}
        {active === 'arenas' && <DefaultArenas ctx={ctx} kicker={kicker(n)} />}
        {active === null && <DoneCard ctx={ctx} />}
        <NeedsSession api={api} />
        {!net.mainnet && net.info && <TestTokenCard ctx={ctx} onLocal={setLocal} local={local} />}
      </div>
    </div>
  );
}

/** Everything is deployed: the registered contracts, their explorer links and the code hash verdict. */
function DoneCard({ ctx }: { ctx: ChainCtx }) {
  const rows: { name: string; address: string | null; code: string | undefined }[] = [
    { name: 'ElymumArena', address: ctx.net.arenaAddress, code: ctx.status?.arena?.code },
    { name: 'ElymumNFT', address: ctx.net.nftAddress, code: ctx.status?.nft?.code },
  ];
  return (
    <Card title="The ring is built." id="deploy-done" kicker="All seven steps" tone="done" lede="Both contracts are live and registered, the token is set and the four arenas exist. Launch shows what is left: the allowlist, the mint and who may play.">
      <ul className="ad-registered">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="ad-registered__name">{r.name}</span>
            <Addr value={r.address} net={ctx.net} />
            <span className={`ad-code mono${r.code === 'ok' ? ' is-ok' : ' is-bad'}`}>{r.code === 'ok' ? 'code hash ok' : `code ${r.code ?? '…'}`}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The line under every deploy and call: the preview comes first. */
function PreviewFirst() {
  return (
    <p className="ad-previewfirst">
      <Icon name="info" size={16} /> The preview opens first: function, arguments, network and signer. Your wallet only opens from there.
    </p>
  );
}

function ConnectStep({ kicker }: { kicker: string }) {
  return (
    <Card
      title="Connect the owner wallet"
      id="deploy-connect"
      kicker={kicker}
      lede="Use the wallet that should own the contracts (a hardware wallet behind MetaMask or Rabby works). Connect it at the top right; it becomes the owner of everything deployed here."
    />
  );
}

function ChainStep({ ctx, kicker }: { ctx: ChainCtx; kicker: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = ctx.net.info;
  return (
    <Card title="Check the chain" id="deploy-chain" kicker={kicker} lede={info ? `The game server is on ${info.name} (chain ${info.id}). The wallet must sign there.` : 'The game server reports no chain yet.'}>
      <dl className="ad-kv">
        <Row label="Your wallet">
          <span className="num">{ctx.walletChainId ?? 'unknown'}</span>
        </Row>
        <Row label="The server">
          <span className="num">{info ? `${info.name} (${info.id})` : 'none'}</span>
        </Row>
      </dl>
      <Btn
        sun
        disabled={!info || busy}
        testId="deploy-switch"
        onClick={async () => {
          const w = connected();
          if (!w || !ctx.net.chain) return;
          setBusy(true);
          setErr(null);
          try {
            await ensureChain(w.provider, ctx.net.chain);
          } catch (e) {
            setErr(describeError(e, { chainName: info?.name }).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {info ? `Switch to ${info.name}` : 'Switch'}
      </Btn>
      <FormError error={err} />
    </Card>
  );
}

/** Registers a deployed contract with the server, then re-reads the server's chain status. */
async function register(ctx: ChainCtx, kind: ContractKind, address: Address, txHash: Hash | null): Promise<void> {
  if (!ctx.api) throw new Error('Deployed. Sign in as the admin to register it with the server (Register step).');
  await ctx.api.registerContract({ kind, address, txHash });
  await ctx.reloadNet();
}

function ArenaStep({ ctx, onLocal, kicker }: { ctx: ChainCtx; onLocal: (l: LocalDeploys) => void; kicker: string }) {
  const [err, guard] = useFormError();
  return (
    <Card title="Deploy ElymumArena" id="deploy-arena" kicker={kicker} lede="The arena holds the tickets, settles rounds with the server's key and keeps the fee. Its constructor takes three addresses:">
      <dl className="ad-kv ad-kv--args">
        <div>
          <dt className="mono">admin</dt>
          <dd>
            <Addr value={ctx.me} net={ctx.net} /> <span className="ad-role">you</span>
          </dd>
        </div>
        <div>
          <dt className="mono">serverAuthority</dt>
          <dd>
            <Addr value={ctx.net.serverKey} net={ctx.net} /> <span className="ad-role">the game server&apos;s key</span>
          </dd>
        </div>
        <div>
          <dt className="mono">feeWallet</dt>
          <dd>
            <Addr value={ctx.me} net={ctx.net} /> <span className="ad-role">you, for now (Arena changes it)</span>
          </dd>
        </div>
      </dl>
      <PreviewFirst />
      <Btn
        sun
        icon="arrow"
        testId="deploy-arena"
        onClick={() =>
          guard(() => {
            const params = deployArenaParams(arenaDeployArgs(ctx.me, ctx.net.serverKey));
            ctx.open({
              title: 'Deploy ElymumArena',
              contract: 'ElymumArena',
              deploy: { name: 'ElymumArena', params },
              onDone: async ({ address, hash }) => {
                if (!address || !ctx.net.info) return;
                onLocal(saveLocalDeploy(ctx.net.info.id, 'arena', { address, txHash: hash }));
                await register(ctx, 'arena', address, hash);
                await ctx.refresh();
              },
            });
          })
        }
      >
        Preview the deploy
      </Btn>
      <FormError error={err} />
    </Card>
  );
}

function NftStep({ ctx, onLocal, kicker }: { ctx: ChainCtx; onLocal: (l: LocalDeploys) => void; kicker: string }) {
  const [form, setForm] = useState<NftForm>(() => defaultNftForm(location.origin, null, ctx.me));
  const [quote, setQuote] = useState<string | null>(null);
  const [err, guard, setErr] = useFormError();
  // the $1 price in wei from the server (HYPE/USD from Hyperliquid)
  useEffect(() => {
    if (!ctx.api) return;
    let live = true;
    ctx.api.mintPrice().then(
      (q) => {
        if (!live || !q.priceWei) return;
        setQuote(q.hypeUsd !== null ? `HYPE = $${q.hypeUsd}` : null);
        setForm((f) => (f.priceHype ? f : defaultNftForm(location.origin, q.priceWei, ctx.me)));
      },
      (e: Error) => live && setErr(`The $1 price could not be read (${e.message}); enter a HYPE price.`),
    );
    return () => {
      live = false;
    };
  }, [ctx.api, ctx.me, setErr]);
  const set = (k: keyof NftForm) => (v: string) => setForm({ ...form, [k]: v });
  return (
    <Card title="Deploy ElymumNFT" id="deploy-nft" kicker={kicker} lede="The emblem contract. Everything below goes into its constructor; most of it can be changed later from Mint.">
      <div className="ad-form ad-form--grid">
        <Input label="Max supply" value={form.maxSupply} onChange={set('maxSupply')} />
        <Input label="Mint price (HYPE)" suffix="HYPE" value={form.priceHype} onChange={set('priceHype')} hint={quote ? `$1 at ${quote}` : 'From /api/admin/mint/price'} />
        <Input label="Allowlist limit per wallet" value={form.wlLimit} onChange={set('wlLimit')} />
        <Input label="Public limit per wallet" value={form.publicLimit} onChange={set('publicLimit')} />
        <Input label="Base URI" value={form.baseURI} onChange={set('baseURI')} hint="tokenURI = base URI + id" />
        <Input label="Treasury" value={form.treasury} onChange={set('treasury')} hint="withdraw() sends the mint proceeds here" />
      </div>
      <PreviewFirst />
      <Btn
        sun
        icon="arrow"
        testId="deploy-nft"
        onClick={() =>
          guard(() => {
            const params = deployNftParams(nftDeployArgs(form, ctx.me));
            ctx.open({
              title: 'Deploy ElymumNFT',
              contract: 'ElymumNFT',
              deploy: { name: 'ElymumNFT', params },
              onDone: async ({ address, hash }) => {
                if (!address || !ctx.net.info) return;
                onLocal(saveLocalDeploy(ctx.net.info.id, 'nft', { address, txHash: hash }));
                await register(ctx, 'nft', address, hash);
                await ctx.refresh();
              },
            });
          })
        }
      >
        Preview the deploy
      </Btn>
      <FormError error={err} />
    </Card>
  );
}

function RegisterStep({ ctx, local, onLocal, kicker }: { ctx: ChainCtx; local: LocalDeploys; onLocal: (l: LocalDeploys) => void; kicker: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todo = (['arena', 'nft'] as const).filter((k) => local[k] && !(k === 'arena' ? ctx.net.arenaAddress : ctx.net.nftAddress));
  return (
    <Card title="Register with the server" id="deploy-register" kicker={kicker} lede="The server checks each address (code hash, owner = you, and for the arena that the server authority is its key) and stores it.">
      {todo.length === 0 && <p className="ad-note">Nothing deployed from this browser is waiting. Deploy the missing contract first.</p>}
      {todo.map((k) => (
        <p key={k} className="ad-registered__row">
          <span className="ad-registered__name">{k === 'arena' ? 'ElymumArena' : 'ElymumNFT'}</span> <Addr value={local[k]!.address} net={ctx.net} />
        </p>
      ))}
      <div className="ad-actions">
      <Btn
        sun
        disabled={busy || todo.length === 0 || !ctx.api}
        testId="deploy-register"
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            for (const k of todo) {
              if (ctx.client) {
                const code = await checkDeployedCode(ctx.client, local[k]!.address, k);
                if (code !== 'ok') throw new Error(`${k}: the code at ${local[k]!.address} is ${code === 'missing' ? 'missing' : 'not the bundled contract'}.`);
              }
              await register(ctx, k, local[k]!.address, local[k]!.txHash);
            }
            await ctx.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Register
      </Btn>
      {Object.keys(local).length > 0 && ctx.net.info && (
        <Btn onClick={() => (['arena', 'nft'] as const).forEach((k) => onLocal(saveLocalDeploy(ctx.net.info!.id, k, null)))}>Forget local deploys</Btn>
      )}
      </div>
      <FormError error={err} />
    </Card>
  );
}

/** The set-token rail: the address is typed twice; it can be set only once. */
export function SetTokenForm({ ctx, kicker }: { ctx: ChainCtx; kicker?: string }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  if (!arena || !cfg) return <Card title="Set the game token" id="set-token" kicker={kicker} lede="Deploy and register the arena first." tone="quiet" />;
  if (cfg.token)
    return (
      <Card title="Game token" id="set-token" kicker="Set once, forever">
        <p className="ad-inline">
          <Addr value={cfg.token} net={ctx.net} /> <span className="ad-role num">{cfg.decimals} decimals</span>
        </p>
      </Card>
    );
  return (
    <Card title="Set the game token" id="set-token" kicker={kicker ?? 'Once, forever'} tone="danger" lede="The ERC-20 the arenas take ($ELYMUM). Paste its address twice: a typo here cannot be undone, ever.">
      <div className="ad-form">
        <Input label="Token address" value={a} onChange={setA} placeholder="0x…" />
        <Input label="Token address (again)" value={b} onChange={setB} placeholder="0x…" />
      </div>
      <Btn
        danger
        testId="set-token"
        onClick={async () => {
          setErr(null);
          try {
            const token = confirmTypedAddress('Token', a, b);
            const code = ctx.client ? await ctx.client.getCode({ address: token }) : '0x1';
            const refusal = setTokenRefusal(cfg, token, !!code && code !== '0x');
            if (refusal) throw new Error(refusal);
            ctx.open({
              title: 'Set the game token (once, forever)',
              contract: 'ElymumArena',
              call: setTokenCall(arena, token),
              ownerOf: arena,
              owner: cfg.admin,
              note: 'The token can be set only once. Check the address against the official announcement.',
              onDone: () => ctx.refresh(),
            });
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Preview setToken
      </Btn>
      <FormError error={err} />
    </Card>
  );
}

/** Creates the default tiers that do not exist yet, one previewed call at a time. */
export function DefaultArenas({ ctx, kicker }: { ctx: ChainCtx; kicker?: string }) {
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  if (!arena || !cfg?.token) return null;
  const existing = (ctx.status?.arena?.arenas ?? []).filter((x) => x.exists).map((x) => x.id);
  const plan = planDefaultArenas(cfg.decimals, existing);
  const next = plan.create[0];
  if (!next) return null;
  return (
    <Card title="Create the four arenas" id="default-arenas" kicker={kicker} lede={plan.skip.length ? `Already created: ${plan.skip.map((id) => `#${id}`).join(', ')}. One previewed call per arena.` : 'One previewed call per arena, in order.'}>
      <div className="ad-tablewrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Place</th>
              <th scope="col" className="is-num">Entry fee</th>
              <th scope="col" className="is-num">Max tickets</th>
            </tr>
          </thead>
          <tbody>
            {plan.create.map((p, i) => (
              <tr key={p.id} className={i === 0 ? 'is-next' : undefined}>
                <td className="num">#{p.id}</td>
                <td>{arenaName(p.id)}</td>
                <td className="num is-num">{fmtTok(p.entryFee, cfg.decimals)}</td>
                <td className="num is-num">{p.maxSessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next ? (
        <Btn
          sun
          testId="create-arena"
          onClick={() =>
            ctx.open({
              title: `Create arena #${next.id} ${arenaName(next.id)}`,
              contract: 'ElymumArena',
              call: createArenaCall(arena, next),
              ownerOf: arena,
              owner: cfg.admin,
              onDone: () => ctx.refresh(),
            })
          }
        >
          Preview arena #{next.id}
        </Btn>
      ) : (
        <p className="ad-note">All four default arenas exist.</p>
      )}
    </Card>
  );
}

/** Off mainnet: a TestToken to try the arena flow before $ELYMUM exists, and its faucet. */
function TestTokenCard({ ctx, local, onLocal }: { ctx: ChainCtx; local: LocalDeploys; onLocal: (l: LocalDeploys) => void }) {
  const [err, guard] = useFormError();
  const refusal = ctx.net.info ? testTokenRefusal(ctx.net.info.id) : 'no chain';
  if (refusal) return null;
  const token = (ctx.status?.arena?.config?.token ?? local.token?.address ?? null) as Address | null;
  return (
    <Card title="TestToken" id="test-token" kicker="Off mainnet only" tone="quiet" lede={`A mintable ERC-20 with a faucet (1,000,000 per hour), to try the arena before $ELYMUM exists. ${testTokenArtifact.contractName} is never offered on mainnet.`}>
      {token && (
        <p className="ad-inline">
          <span className="ad-registered__name">Token</span> <Addr value={token} net={ctx.net} />
        </p>
      )}
      <div className="ad-actions">
        <Btn
          testId="deploy-test-token"
          onClick={() =>
            guard(() => {
              if (!ctx.me) throw new Error('Connect the owner wallet first.');
              ctx.open({
                title: 'Deploy TestToken',
                contract: 'TestToken',
                deploy: { name: 'TestToken', params: deployTestTokenParams({ owner: ctx.me }) },
                onDone: async ({ address, hash }) => {
                  if (!address || !ctx.net.info) return;
                  onLocal(saveLocalDeploy(ctx.net.info.id, 'token', { address, txHash: hash }));
                  if (ctx.api) await ctx.api.registerContract({ kind: 'token', address, txHash: hash });
                },
              });
            })
          }
        >
          Deploy a TestToken
        </Btn>
        {token && (
          <Btn
            testId="faucet"
            onClick={() => ctx.open({ title: 'TestToken faucet (1,000,000 to you)', contract: 'TestToken', call: faucetCall(token), onDone: () => ctx.refresh() })}
          >
            Faucet
          </Btn>
        )}
      </div>
      <FormError error={err} />
    </Card>
  );
}
