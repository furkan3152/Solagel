import { testTokenRefusal } from '@elymum/sdk/ops';
import { DeployTab, RegisterExisting, SetTokenForm, TestTokenCard, registeredToken } from './DeployTab';
import { QuickSetup } from './QuickSetup';
import { setupSteps } from './setup';
import { HolderPerksCard, HoldersOnlyCard, TestTokenAdminCard } from './SetupExtras';
import { Advanced, type ChainCtx } from './ui';

/**
 * What Setup puts in front of the owner (pure, tested): the deploy wizard while the contracts are
 * not on the server yet, otherwise Finish setup, plus the few owner cards Finish setup cannot do
 * (confirming the game token on mainnet, deploying a TestToken on a testnet without one).
 */
export function setupLayout(ctx: Pick<ChainCtx, 'net' | 'status' | 'registry'>): { registered: boolean; tokenCard: boolean; testTokenCard: boolean } {
  const { net, status } = ctx;
  const registered = !!net.arenaAddress && !!net.nftAddress;
  const cfg = status?.arena?.config ?? null;
  const quickSetsToken = setupSteps({ net, status }, { openMint: !net.mainnet }).some((s) => s.id === 'token');
  const testnet = !!net.info && !testTokenRefusal(net.info.id);
  return {
    registered,
    // the token is not set and Finish setup will not set it (mainnet, or no TestToken yet)
    tokenCard: registered && !!cfg && !cfg.token && !quickSetsToken && (!!registeredToken(ctx) || !testnet),
    testTokenCard: registered && testnet && !!cfg && !cfg.token && !registeredToken(ctx),
  };
}

/**
 * `/admin → Setup`. Contracts registered: Finish setup first (every missing owner step in one go),
 * and every manual control and address override in ONE collapsed "Advanced" section at the bottom.
 * Nothing deployed yet (a fresh chain, mainnet day): the deploy wizard, which asks for no address.
 */
export function SetupTab({ ctx }: { ctx: ChainCtx }) {
  const { registered, tokenCard, testTokenCard } = setupLayout(ctx);
  if (!registered)
    return (
      <>
        <DeployTab ctx={ctx} />
        <Advanced title="Advanced: manual controls" testId="setup-advanced" section>
          <RegisterExisting ctx={ctx} />
        </Advanced>
      </>
    );
  return (
    <>
      <QuickSetup ctx={ctx} />
      {tokenCard && <SetTokenForm ctx={ctx} />}
      {testTokenCard && <TestTokenCard ctx={ctx} />}
      <Advanced title="Advanced: manual controls" testId="setup-advanced" section>
        <p className="ad-note">Finish setup does all of this for you. These are the same steps one by one, and the places to override an address.</p>
        <DeployTab ctx={ctx} advanced />
        {!tokenCard && <SetTokenForm ctx={ctx} />}
        {!testTokenCard && <TestTokenCard ctx={ctx} />}
        <RegisterExisting ctx={ctx} />
        <h2 className="ad-h3 ad-section-h">Emblem perks</h2>
        <div className="ad-mint__forms">
          <HolderPerksCard ctx={ctx} />
          <TestTokenAdminCard ctx={ctx} />
        </div>
        <HoldersOnlyCard ctx={ctx} />
      </Advanced>
    </>
  );
}
