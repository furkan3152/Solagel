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
import { Addr, Btn, Card, FormError, Input, NeedsSession, useFormError, type ChainCtx } from './ui';

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

  return (
    <div className="ad-deploy">
      <Card title="Deploy" id="deploy" lede="Every contract is deployed from your wallet, which becomes its owner. Nothing here uses a server key except as the arena's settler.">
        <ol className="ad-steps" data-testid="deploy-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`ad-step is-${s.state}`} data-step={s.id} data-state={s.state}>
              <span className="ad-step__n mono">{i + 1}</span> <strong>{s.label}</strong> <span className="ad-note">{s.detail}</span>
            </li>
          ))}
        </ol>
      </Card>
      {active === 'connect' && <ConnectStep />}
      {active === 'chain' && <ChainStep ctx={ctx} />}
      {active === 'arena' && <ArenaStep ctx={ctx} onLocal={setLocal} />}
      {active === 'nft' && <NftStep ctx={ctx} onLocal={setLocal} />}
      {active === 'register' && <RegisterStep ctx={ctx} local={local} onLocal={setLocal} />}
      {active === 'token' && <SetTokenForm ctx={ctx} />}
      {active === 'arenas' && <DefaultArenas ctx={ctx} />}
      {active === null && (
        <Card title="All deployed" id="deploy-done" lede="Both contracts are live and registered, the token is set and the four arenas exist. The Launch tab shows what is left (mint, game access).">
          <></>
        </Card>
      )}
      {!net.mainnet && net.info && <TestTokenCard ctx={ctx} onLocal={setLocal} local={local} />}
      <NeedsSession api={api} />
    </div>
  );
}

function ConnectStep() {
  return (
    <Card title="1 · Connect the owner wallet" id="deploy-connect" lede="Use the wallet that should own the contracts (a hardware wallet behind MetaMask or Rabby works). Connect it in the session box above." >
      <></>
    </Card>
  );
}

function ChainStep({ ctx }: { ctx: ChainCtx }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = ctx.net.info;
  return (
    <Card title="2 · Check the chain" id="deploy-chain" lede={info ? `The game server is on ${info.name} (chain ${info.id}). The wallet must sign there.` : 'The game server reports no chain yet.'}>
      <p className="ad-note">Wallet chain: {ctx.walletChainId ?? 'unknown'}</p>
      <Btn
        primary
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

function ArenaStep({ ctx, onLocal }: { ctx: ChainCtx; onLocal: (l: LocalDeploys) => void }) {
  const [err, guard] = useFormError();
  return (
    <Card title="3 · Deploy ElymumArena" id="deploy-arena">
      <dl className="ad-kv">
        <div>
          <dt className="mono">admin</dt>
          <dd>
            <Addr value={ctx.me} net={ctx.net} /> (you)
          </dd>
        </div>
        <div>
          <dt className="mono">serverAuthority</dt>
          <dd>
            <Addr value={ctx.net.serverKey} net={ctx.net} /> (the game server's key)
          </dd>
        </div>
        <div>
          <dt className="mono">feeWallet</dt>
          <dd>
            <Addr value={ctx.me} net={ctx.net} /> (you; change it later in Arena)
          </dd>
        </div>
      </dl>
      <Btn
        primary
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

function NftStep({ ctx, onLocal }: { ctx: ChainCtx; onLocal: (l: LocalDeploys) => void }) {
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
    <Card title="4 · Deploy ElymumNFT" id="deploy-nft">
      <div className="ad-form">
        <Input label="Max supply" value={form.maxSupply} onChange={set('maxSupply')} />
        <Input label="Mint price (HYPE)" value={form.priceHype} onChange={set('priceHype')} hint={quote ? `$1 at ${quote}` : 'From /api/admin/mint/price'} />
        <Input label="Allowlist limit per wallet" value={form.wlLimit} onChange={set('wlLimit')} />
        <Input label="Public limit per wallet" value={form.publicLimit} onChange={set('publicLimit')} />
        <Input label="Base URI" value={form.baseURI} onChange={set('baseURI')} hint="tokenURI = base URI + id" />
        <Input label="Treasury" value={form.treasury} onChange={set('treasury')} hint="withdraw() sends the mint proceeds here" />
      </div>
      <Btn
        primary
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

function RegisterStep({ ctx, local, onLocal }: { ctx: ChainCtx; local: LocalDeploys; onLocal: (l: LocalDeploys) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todo = (['arena', 'nft'] as const).filter((k) => local[k] && !(k === 'arena' ? ctx.net.arenaAddress : ctx.net.nftAddress));
  return (
    <Card title="5 · Register with the server" id="deploy-register" lede="The server checks each address (code hash, owner = you, and for the arena that the server authority is its key) and stores it.">
      {todo.length === 0 && <p className="ad-note">Nothing deployed from this browser is waiting. Deploy the missing contract first.</p>}
      {todo.map((k) => (
        <p key={k}>
          {k === 'arena' ? 'ElymumArena' : 'ElymumNFT'} <Addr value={local[k]!.address} net={ctx.net} />
        </p>
      ))}
      <Btn
        primary
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
      <FormError error={err} />
    </Card>
  );
}

/** The set-token rail: the address is typed twice; it can be set only once. */
export function SetTokenForm({ ctx }: { ctx: ChainCtx }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  if (!arena || !cfg) return <Card title="Set the game token" id="set-token" lede="Deploy and register the arena first."><></></Card>;
  if (cfg.token)
    return (
      <Card title="Game token" id="set-token">
        <p>
          Set to <Addr value={cfg.token} net={ctx.net} /> ({cfg.decimals} decimals). It can never change.
        </p>
      </Card>
    );
  return (
    <Card title="6 · Set the game token" id="set-token" lede="The ERC-20 the arenas take ($ELYMUM). Paste its address twice: a typo here cannot be undone.">
      <Input label="Token address" value={a} onChange={setA} placeholder="0x…" />
      <Input label="Token address (again)" value={b} onChange={setB} placeholder="0x…" />
      <Btn
        primary
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
export function DefaultArenas({ ctx }: { ctx: ChainCtx }) {
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  if (!arena || !cfg?.token) return null;
  const existing = (ctx.status?.arena?.arenas ?? []).filter((x) => x.exists).map((x) => x.id);
  const plan = planDefaultArenas(cfg.decimals, existing);
  const next = plan.create[0];
  return (
    <Card title="7 · Create the four arenas" id="default-arenas" lede={plan.skip.length ? `Already created: ${plan.skip.map((id) => `#${id}`).join(', ')}.` : undefined}>
      <ul>
        {plan.create.map((p) => (
          <li key={p.id}>
            #{p.id} {arenaName(p.id)} · {fmtTok(p.entryFee, cfg.decimals)} · max {p.maxSessions} tickets
          </li>
        ))}
      </ul>
      {next ? (
        <Btn
          primary
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
    <Card title="TestToken (testnet only)" id="test-token" lede={`A mintable ERC-20 with a faucet (1,000,000 per hour). ${testTokenArtifact.contractName} is never offered on mainnet.`}>
      {token && (
        <p>
          Token: <Addr value={token} net={ctx.net} />
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
