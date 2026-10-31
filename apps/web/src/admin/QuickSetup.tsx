import { DEFAULT_HOLDER_FEE_BPS, DEFAULT_HOLDERS_ONLY_ARENA_IDS, createDefaultArenaCalls, sameAddress, setArenaHoldersOnlyCall, setHolderNftCall, setHolderPerksCall, setMinterCall, setPhaseCall, setTokenCall, type ContractCall } from '@elymum/sdk';
import { arenaName } from '@elymum/sdk/ops';
import { useRef, useState } from 'react';
import type { Address, Hash } from 'viem';
import { sendWithWallet, txErrorText } from '../wallet/tx';
import { sendPlan, type Plan } from './plan';
import { Btn, Card, FormError, Mark, type ChainCtx } from './ui';

/** One step of the setup: what it does, and the call the owner's wallet signs. */
export interface SetupStep {
  id: string;
  label: string;
  call: ContractCall;
}

/**
 * What is still missing for a playable chain, in order: the game token on the arena, the four
 * arenas, the server key as TestToken minter (bots), the emblem as the faucet's 2x and as the arena's
 * holder perk, the Isles as holders-only, and (testnet) the mint opened to the public. Steps already
 * done on chain are left out, so the button can be pressed again after an interruption.
 */
export function setupSteps(ctx: ChainCtx, opts: { openMint: boolean }): SetupStep[] {
  const s = ctx.status;
  const arena = s?.arena?.address ?? null;
  const cfg = s?.arena?.config ?? null;
  const nft = s?.nft?.address ?? null;
  const tt = s?.testToken ?? null;
  const serverKey = (cfg?.serverAuthority ?? ctx.net.serverKey ?? null) as Address | null;
  const out: SetupStep[] = [];
  if (!arena || !cfg) return out;
  const token = (cfg.token ?? tt?.address ?? null) as Address | null;
  if (!cfg.token && tt?.address) out.push({ id: 'token', label: 'Set tELYMUM as the game token', call: setTokenCall(arena, tt.address) });
  if (token) {
    const decimals = s?.arena?.token?.decimals ?? 18;
    const existing = (s?.arena?.arenas ?? []).filter((a) => a.exists).map((a) => a.id);
    for (const call of createDefaultArenaCalls(arena, decimals, existing)) {
      const id = Number((call.args as readonly unknown[])[0]);
      out.push({ id: `arena-${id}`, label: `Create ${arenaName(id)}`, call });
    }
  }
  if (tt?.address && serverKey && tt.serverIsMinter !== true) out.push({ id: 'minter', label: 'Let the server key mint tELYMUM (testnet bots)', call: setMinterCall(tt.address, serverKey, true) });
  if (tt?.address && nft && !sameAddress(tt.faucet?.holderNft ?? null, nft)) out.push({ id: 'faucet-nft', label: 'Emblem holders get 2x from the faucet', call: setHolderNftCall(tt.address, nft) });
  if (nft && !sameAddress(cfg.holderNft ?? null, nft)) out.push({ id: 'perks', label: `Emblem holders pay ${DEFAULT_HOLDER_FEE_BPS / 100} % instead of ${cfg.feeBps / 100} %`, call: setHolderPerksCall(arena, nft, DEFAULT_HOLDER_FEE_BPS) });
  if (nft) {
    const known = new Map((s?.arena?.arenas ?? []).map((a) => [a.id, a]));
    for (const id of DEFAULT_HOLDERS_ONLY_ARENA_IDS) {
      const a = known.get(id);
      // created in this run, or existing but still open to everyone
      if ((!a || !a.exists) && token) out.push({ id: `holders-${id}`, label: `${arenaName(id)}: emblem holders only`, call: setArenaHoldersOnlyCall(arena, id, true) });
      else if (a && a.exists && !a.holdersOnly) out.push({ id: `holders-${id}`, label: `${arenaName(id)}: emblem holders only`, call: setArenaHoldersOnlyCall(arena, id, true) });
    }
  }
  if (opts.openMint && nft && s?.nft?.state && s.nft.state.phaseName !== 'public') out.push({ id: 'mint', label: 'Open the mint to everyone (Public)', call: setPhaseCall(nft, 'public') });
  return out;
}

type Run = { list: SetupStep[]; at: number; done: string[]; hashes: Hash[]; error: string | null; busy: boolean };

/**
 * "Finish setup": every missing owner step in one go. The wallet asks once per step (they are
 * separate transactions); nothing else to click in between. Stops at the first refusal and can be
 * resumed (finished steps are read back from the chain and skipped).
 */
export function QuickSetup({ ctx }: { ctx: ChainCtx }) {
  const openMint = !ctx.net.mainnet;
  const steps = setupSteps(ctx, { openMint });
  const [run, setRun] = useState<Run | null>(null);
  const inFlight = useRef(false);
  const ownerOk = !!ctx.me && !!ctx.status?.arena?.config && sameAddress(ctx.status.arena.config.admin, ctx.me);
  const blocked = !ctx.me ? 'Connect the owner wallet first.' : !ctx.status?.arena ? 'The arena is not known to the server yet.' : !ownerOk ? 'The connected wallet is not the arena owner.' : null;

  const go = async () => {
    const chain = ctx.net.chain;
    if (inFlight.current || steps.length === 0 || blocked || !chain) return;
    inFlight.current = true;
    const list = steps;
    const r: Run = { list, at: 0, done: [], hashes: [], error: null, busy: true };
    setRun({ ...r });
    for (let i = 0; i < list.length; i++) {
      r.at = i;
      setRun({ ...r });
      const plan: Plan = { title: list[i].label, contract: 'Setup', call: list[i].call };
      const res = await sendWithWallet((wallet, from) => sendPlan(plan, wallet, from), { chain, publicClient: ctx.client });
      if (!res.ok) {
        r.error = `${list[i].label}: ${txErrorText(res.error)}`;
        r.busy = false;
        setRun({ ...r });
        inFlight.current = false;
        await ctx.refresh();
        return;
      }
      r.done.push(list[i].id);
      r.hashes.push(res.hash);
      setRun({ ...r });
    }
    r.busy = false;
    r.at = list.length;
    setRun({ ...r });
    inFlight.current = false;
    await ctx.refresh();
    await ctx.reloadNet();
  };

  const shown = run && (run.busy || run.error) ? run.list : steps;
  return (
    <Card
      title="Finish setup"
      id="quick-setup"
      kicker={steps.length === 0 ? 'All set' : `${steps.length} step${steps.length === 1 ? '' : 's'} left`}
      lede={
        steps.length === 0
          ? 'The token, the arenas, the bots, the emblem perks' + (openMint ? ' and the public mint' : '') + ' are all in place on this chain.'
          : 'Everything still missing on this chain, in one go. Your wallet asks once per step; you only confirm.'
      }
    >
      {steps.length > 0 && (
        <ol className="ad-checks" data-testid="quick-setup-steps">
          {shown.map((s, i) => {
            const state = run?.done.includes(s.id) ? 'ok' : run?.busy && run.at === i ? 'active' : 'todo';
            return (
              <li key={s.id} className={`ad-check-line is-${state === 'active' ? 'unknown' : state}`}>
                <Mark state={state} />
                <span className="ad-check-line__label">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="ad-actions">
        <Btn sun icon="check" testId="quick-setup-go" disabled={!!blocked || steps.length === 0 || !!run?.busy} onClick={() => void go()}>
          {run?.busy ? `Step ${run.at + 1} of ${run.list.length}…` : run?.error ? 'Continue setup' : 'Finish setup'}
        </Btn>
      </div>
      {blocked && steps.length > 0 && <p className="ad-note">{blocked}</p>}
      <FormError error={run?.error ?? null} />
    </Card>
  );
}
