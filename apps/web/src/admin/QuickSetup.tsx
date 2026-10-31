import { sameAddress } from '@elymum/sdk';
import { useRef, useState } from 'react';
import type { Hash } from 'viem';
import { sendWithWallet, txErrorText } from '../wallet/tx';
import { sendPlan, type Plan } from './plan';
import { setupSteps, type SetupStep } from './setup';
import { Addr, Btn, Card, FormError, Mark, Row, type ChainCtx } from './ui';

export { setupSteps, type SetupStep };

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

  // the addresses the steps use, all known already (shown, never typed)
  const cfg = ctx.status?.arena?.config ?? null;
  const token = cfg?.token ?? ctx.status?.testToken?.address ?? null;
  const nft = ctx.status?.nft?.address ?? ctx.net.nftAddress;
  const serverKey = cfg?.serverAuthority ?? ctx.net.serverKey;
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
        <dl className="ad-kv" data-testid="quick-setup-uses">
          {token && (
            <Row label="Game token">
              <Addr value={token} net={ctx.net} /> <span className="ad-role">{cfg?.token ? 'set' : 'registered with the server'}</span>
            </Row>
          )}
          {nft && (
            <Row label="Emblem">
              <Addr value={nft} net={ctx.net} /> <span className="ad-role">the registered ElymumNFT</span>
            </Row>
          )}
          {serverKey && ctx.status?.testToken && (
            <Row label="Server key">
              <Addr value={serverKey} net={ctx.net} /> <span className="ad-role">from the game server</span>
            </Row>
          )}
        </dl>
      )}
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
