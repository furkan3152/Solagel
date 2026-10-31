import { createArenaCall, deployArenaParams, deployNftParams, deployTestTokenParams, faucetCall, testTokenArtifact } from '@elymum/sdk';
import { checkDeployedCode, confirmTypedAddress, planDefaultArenas, setTokenRefusal, testTokenRefusal, arenaName, fmtTok } from '@elymum/sdk/ops';
import { setTokenCall } from '@elymum/sdk';
import type { ContractKind } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import type { Address, Hash } from 'viem';
import { describeError } from '@elymum/sdk';
import { ensureChain } from '../wallet/network';
import { connected } from '../wallet/store';
import { activeStep, arenaDeployArgs, defaultNftForm, deploySteps, loadLocalDeploys, nftDeployArgs, saveLocalDeploy, type LocalDeploys, type NftForm } from './deploy';
import { Icon } from '../design';
import { Addr, Advanced, Btn, Card, FormError, Input, NeedsSession, Row, useFormError, type ChainCtx } from './ui';
import type { AdminApi } from '../site/api';

/** The contracts deployed from this browser that the server does not know yet. */
export function unregistered(ctx: Pick<ChainCtx, 'net' | 'registry'>, local: LocalDeploys): ('arena' | 'nft' | 'token')[] {
  const out: ('arena' | 'nft' | 'token')[] = [];
  if (local.arena && !ctx.net.arenaAddress) out.push('arena');
  if (local.nft && !ctx.net.nftAddress) out.push('nft');
  // the token only once the registry is read (null while loading, absent in tests)
  if (local.token && ctx.registry && !ctx.registry.token) out.push('token');
  return out;
}

/**
 * `/admin → Setup`, the deploy wizard: the owner deploys everything from their own wallet (spec
 * section 5) and types no address: admin, treasury and fee wallet are the connected wallet, the
 * settler is the server's key, the NFT's base URI is this site. Each deploy goes through the
 * transaction preview; each new contract registers itself with the server (`POST
 * /api/admin/contracts`, which checks its code hash, owner and server authority), and a
 * registration that could not run (no admin session) is retried as soon as the admin signs in.
 * `advanced`: the wizard as a manual control under Setup → Advanced (Finish setup and the game
 * token card do the token step there).
 */
export function DeployTab({ ctx, advanced = false }: { ctx: ChainCtx; advanced?: boolean }) {
  const { net, status, me, walletChainId, api } = ctx;
  const chainId = net.info?.id ?? null;
  const [local, setLocal] = useState<LocalDeploys>(() => loadLocalDeploys(chainId));
  useEffect(() => setLocal(loadLocalDeploys(chainId)), [chainId]);
  const autoErr = useAutoRegister(ctx);
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
              {s.state === 'active' && <StepCrane />}
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
        {active === 'register' && <RegisterStep ctx={ctx} local={local} onLocal={setLocal} kicker={kicker(n)} autoErr={autoErr} />}
        {active === 'token' &&
          (advanced ? (
            <Card title="Set the game token" id="deploy-token-note" kicker={kicker(n)} tone="quiet" lede="Finish setup (top of Setup) sets it, or the game token card in this section with one confirmation." />
          ) : (
            <SetTokenForm ctx={ctx} kicker={kicker(n)} />
          ))}
        {active === 'arenas' && <DefaultArenas ctx={ctx} kicker={kicker(n)} />}
        {active === null && <DoneCard ctx={ctx} />}
        <NeedsSession api={api} />
        {!advanced && !net.mainnet && net.info && <TestTokenCard ctx={ctx} onLocal={setLocal} local={local} />}
      </div>
    </div>
  );
}

/** The little crane over the step being built: it lowers a block, lifts, swings, lowers again. */
function StepCrane() {
  return (
    <svg className="ad-stepcrane" viewBox="0 0 56 52" width={56} height={52} aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ink-fixed)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 50 V8 M50 50 V8 M44 14 L50 20 M44 26 L50 32 M44 38 L50 44" />
        <path d="M6 8 H54 M6 12 H54" />
        <path d="M47 8 L47 2 L10 8" strokeWidth={1.4} />
      </g>
      <g className="ad-stepcrane__load">
        <path className="ad-stepcrane__cable" d="M14 12 V26" stroke="var(--ink-fixed)" strokeWidth={1.4} />
        <g className="ad-stepcrane__block">
          <rect x={8} y={26} width={13} height={9} rx={2} fill="var(--sun)" stroke="var(--ink-fixed)" strokeWidth={2} />
        </g>
      </g>
    </svg>
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
  if (!ctx.api) throw new Error('Deployed. Sign in as the admin (top right): it registers with the server by itself then.');
  await ctx.api.registerContract({ kind, address, txHash });
  await ctx.reloadNet();
}

/**
 * Retries the registration of what this browser deployed but the server does not know yet,
 * once per admin session: right after the admin signs in (again), nothing to click. Returns the
 * last failure, shown by the Register step.
 */
function useAutoRegister(ctx: ChainCtx): string | null {
  const tried = useRef<AdminApi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chainId = ctx.net.info?.id ?? null;
  useEffect(() => {
    const api = ctx.api;
    if (!api || tried.current === api || !chainId) return;
    tried.current = api;
    const local = loadLocalDeploys(chainId);
    const todo = unregistered(ctx, local);
    if (todo.length === 0) return;
    let live = true;
    void (async () => {
      try {
        for (const k of todo) {
          const d = local[k]!;
          if (ctx.client) {
            const code = await checkDeployedCode(ctx.client, d.address, k);
            if (code !== 'ok') throw new Error(`${k}: the code at ${d.address} is ${code === 'missing' ? 'missing' : 'not the bundled contract'}.`);
          }
          await api.registerContract({ kind: k, address: d.address, txHash: d.txHash });
        }
        await ctx.reloadNet();
        await ctx.refresh();
        if (live) setErr(null);
      } catch (e) {
        if (live) setErr(`Automatic registration failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.api, chainId, ctx.registry]);
  return err;
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
  useEffect(() => {
    if (ctx.me) setForm((f) => (f.treasury ? f : { ...f, treasury: ctx.me! }));
  }, [ctx.me]);
  const set = (k: keyof NftForm) => (v: string) => setForm({ ...form, [k]: v });
  return (
    <Card title="Deploy ElymumNFT" id="deploy-nft" kicker={kicker} lede="The emblem contract. Everything below goes into its constructor; most of it can be changed later from Mint.">
      <div className="ad-form ad-form--grid">
        <Input label="Max supply" value={form.maxSupply} onChange={set('maxSupply')} />
        <Input label="Mint price (HYPE)" suffix="HYPE" value={form.priceHype} onChange={set('priceHype')} hint={quote ? `$1 at ${quote}` : 'From /api/admin/mint/price'} />
        <Input label="Allowlist limit per wallet" value={form.wlLimit} onChange={set('wlLimit')} />
        <Input label="Public limit per wallet" value={form.publicLimit} onChange={set('publicLimit')} />
      </div>
      <dl className="ad-kv ad-kv--args">
        <Row label="owner">
          <Addr value={ctx.me} net={ctx.net} /> <span className="ad-role">you</span>
        </Row>
        <Row label="treasury">
          <Addr value={form.treasury || null} net={ctx.net} /> <span className="ad-role">{ctx.me && form.treasury.toLowerCase() === ctx.me.toLowerCase() ? 'you: withdraw() sends the proceeds here' : 'withdraw() sends the proceeds here'}</span>
        </Row>
        <Row label="baseURI">
          <code className="ad-addr__v">{form.baseURI}</code> <span className="ad-role">this site (tokenURI = base URI + id)</span>
        </Row>
      </dl>
      <Advanced title="Advanced: a different treasury or base URI" testId="nft-advanced">
        <div className="ad-form ad-form--grid">
          <Input label="Base URI" value={form.baseURI} onChange={set('baseURI')} hint="tokenURI = base URI + id" />
          <Input label="Treasury" value={form.treasury} onChange={set('treasury')} hint="withdraw() sends the mint proceeds here" />
        </div>
      </Advanced>
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

function RegisterStep({ ctx, local, onLocal, kicker, autoErr }: { ctx: ChainCtx; local: LocalDeploys; onLocal: (l: LocalDeploys) => void; kicker: string; autoErr: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todo = (['arena', 'nft'] as const).filter((k) => local[k] && !(k === 'arena' ? ctx.net.arenaAddress : ctx.net.nftAddress));
  return (
    <Card
      title="Register with the server"
      id="deploy-register"
      kicker={kicker}
      lede={
        ctx.api
          ? 'This happens by itself after each deploy. The server checks each address (code hash, owner = you, and for the arena that the server authority is its key) and stores it. If it did not go through, press Register.'
          : 'Sign in as the admin (top right): the deployed contracts below register by themselves then. The server checks the code hash, the owner and the settler.'
      }
    >
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
      <FormError error={err ?? autoErr} />
    </Card>
  );
}

/**
 * Registers a contract that is already on chain (deployed from another browser, or when the
 * admin session expired between the deploy and its registration): paste the address, the
 * server runs the same checks (code hash, owner = you, server authority for the arena).
 */
export function RegisterExisting({ ctx }: { ctx: ChainCtx }) {
  const [kind, setKind] = useState<ContractKind>('arena');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const address = /^0x[0-9a-fA-F]{40}$/.test(text.trim()) ? (text.trim() as Address) : null;
  const NAMES: Record<ContractKind, string> = { arena: 'ElymumArena', nft: 'ElymumNFT', token: 'Game token / TestToken' };
  return (
    <Card title="Register a contract that is already deployed" id="deploy-register-existing" lede="Deployed it but it does not show as registered? Paste its address. The server checks the code hash, that you own it, and for the arena that the server key settles it.">
      <div className="ad-choice" role="radiogroup" aria-label="Contract">
        {(['arena', 'nft', 'token'] as const).map((k) => (
          <label key={k} className={`ad-choice__opt${kind === k ? ' is-on' : ''}`}>
            <input type="radio" name="reg-kind" checked={kind === k} onChange={() => setKind(k)} /> {NAMES[k]}
          </label>
        ))}
      </div>
      <Input label="Contract address" value={text} onChange={setText} placeholder="0x…" hint={text && !address ? 'Paste a 0x address (42 characters).' : undefined} />
      <div className="ad-actions">
        <Btn
          sun
          testId="register-existing"
          disabled={busy || !address || !ctx.api}
          onClick={async () => {
            if (!address) return;
            setBusy(true);
            setErr(null);
            setDone(null);
            try {
              if (ctx.client) {
                const code = await checkDeployedCode(ctx.client, address, kind);
                if (code !== 'ok') throw new Error(`The code at ${address} is ${code === 'missing' ? 'missing (wrong network or address?)' : 'not the bundled ' + NAMES[kind]}.`);
              }
              await register(ctx, kind, address, null);
              await ctx.refresh();
              setDone(`${NAMES[kind]} registered.`);
              setText('');
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Register
        </Btn>
      </div>
      {!ctx.api && <NeedsSession api={ctx.api} />}
      {done && <p className="ad-note ad-ok">{done}</p>}
      <FormError error={err} />
    </Card>
  );
}

/** The game token the server knows (the registry's `token`, or the TestToken it reads off mainnet). */
export function registeredToken(ctx: Pick<ChainCtx, 'registry' | 'status'>): Address | null {
  return ((ctx.registry?.token?.address ?? ctx.status?.testToken?.address ?? null) as Address | null) || null;
}

/**
 * The set-token rail. With a token registered on the server (TOKEN_ADDRESS, or the deployed
 * TestToken) the owner only confirms it (the preview is the confirmation). A different address is
 * an override under Advanced, typed twice. It can be set only once.
 */
export function SetTokenForm({ ctx, kicker }: { ctx: ChainCtx; kicker?: string }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cfg = ctx.status?.arena?.config ?? null;
  const arena = ctx.net.arenaAddress;
  const known = registeredToken(ctx);
  if (!arena || !cfg) return <Card title="Set the game token" id="set-token" kicker={kicker} lede="Deploy the arena first." tone="quiet" />;
  if (cfg.token)
    return (
      <Card title="Game token" id="set-token" kicker="Set once, forever">
        <p className="ad-inline">
          <Addr value={cfg.token} net={ctx.net} /> <span className="ad-role num">{cfg.decimals} decimals</span>
        </p>
      </Card>
    );
  const preview = async (token: Address) => {
    const code = ctx.client ? await ctx.client.getCode({ address: token }) : '0x1';
    const refusal = setTokenRefusal(cfg, token, !!code && code !== '0x');
    if (refusal) throw new Error(refusal);
    ctx.open({
      title: 'Set the game token (once, forever)',
      contract: 'ElymumArena',
      call: setTokenCall(arena, token),
      ownerOf: arena,
      owner: cfg.admin,
      note: known && token.toLowerCase() === known.toLowerCase() ? 'The token the server has registered. It can be set only once: check it against the official announcement.' : 'Not the registered token. It can be set only once: check the address against the official announcement.',
      onDone: () => ctx.refresh(),
    });
  };
  const run = (fn: () => Promise<void>) => {
    setErr(null);
    fn().catch((e: Error) => setErr(e.message));
  };
  return (
    <Card
      title="Set the game token"
      id="set-token"
      kicker={kicker ?? 'Once, forever'}
      tone="danger"
      lede={
        known
          ? 'The ERC-20 the arenas take. The server already knows it: check it, then confirm once in the preview. It can never be changed.'
          : 'The ERC-20 the arenas take ($ELYMUM). The server has no game token registered yet: set TOKEN_ADDRESS on the game server (Render) and reload, and it shows up here.'
      }
    >
      {known && (
        <>
          <dl className="ad-kv">
            <Row label="Registered token">
              <Addr value={known} net={ctx.net} />
            </Row>
          </dl>
          <div className="ad-actions">
            <Btn danger testId="set-token" onClick={() => run(() => preview(known))}>
              Preview setToken
            </Btn>
          </div>
        </>
      )}
      <Advanced title={known ? 'Advanced: use a different token address' : 'Advanced: enter the token address by hand'} testId="set-token-advanced">
        <p className="ad-note">Typed twice: a typo here cannot be undone, ever.</p>
        <div className="ad-form">
          <Input label="Token address" value={a} onChange={setA} placeholder="0x…" />
          <Input label="Token address (again)" value={b} onChange={setB} placeholder="0x…" />
        </div>
        <div className="ad-actions">
          <Btn danger testId="set-token-typed" onClick={() => run(async () => preview(confirmTypedAddress('Token', a, b)))}>
            Preview setToken with this address
          </Btn>
        </div>
      </Advanced>
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
export function TestTokenCard({ ctx, local: given, onLocal: onGiven }: { ctx: ChainCtx; local?: LocalDeploys; onLocal?: (l: LocalDeploys) => void }) {
  const [err, guard] = useFormError();
  const [own, setOwn] = useState<LocalDeploys>(() => loadLocalDeploys(ctx.net.info?.id));
  const local = given ?? own;
  const onLocal = onGiven ?? setOwn;
  const refusal = ctx.net.info ? testTokenRefusal(ctx.net.info.id) : 'no chain';
  if (refusal) return null;
  const token = (ctx.status?.arena?.config?.token ?? registeredToken(ctx) ?? local.token?.address ?? null) as Address | null;
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
                  if (!ctx.api) throw new Error('Deployed. Sign in as the admin (top right): it registers with the server by itself then.');
                  await ctx.api.registerContract({ kind: 'token', address, txHash: hash });
                  await ctx.reloadNet();
                  await ctx.refresh();
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
