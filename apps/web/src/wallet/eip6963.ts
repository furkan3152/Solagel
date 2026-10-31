/**
 * EIP-6963 (multi injected provider discovery) with the legacy `window.ethereum` fallback.
 * Every browser wallet that follows the standard (MetaMask, Rabby, Coinbase Wallet, OKX,
 * and others) announces itself with an `eip6963:announceProvider` event when the
 * page dispatches `eip6963:requestProvider`. Wallets that predate the standard only set
 * `window.ethereum`; it is listed as "Browser wallet" unless an announced wallet is that same
 * provider object.
 */

/** The EIP-1193 surface the app uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): unknown;
  removeListener?(event: string, listener: (...args: never[]) => void): unknown;
}

export interface ProviderInfo {
  /** Unique per page load (EIP-6963), `injected` for the `window.ethereum` fallback. */
  uuid: string;
  name: string;
  /** Data URI (may be empty for the fallback). */
  icon: string;
  /** Reverse-DNS id (`io.metamask`, `io.rabby`); stable across reloads, so it is what we remember. */
  rdns: string;
}

export interface ProviderDetail {
  info: ProviderInfo;
  provider: Eip1193Provider;
}

export const INJECTED_RDNS = 'injected';

interface AnnounceEvent extends Event {
  detail?: { info?: Partial<ProviderInfo>; provider?: Eip1193Provider };
}

const isProvider = (p: unknown): p is Eip1193Provider => !!p && typeof (p as Eip1193Provider).request === 'function';

function validInfo(info: Partial<ProviderInfo> | undefined): info is ProviderInfo {
  return !!info && typeof info.uuid === 'string' && typeof info.name === 'string' && info.name.length > 0 && typeof info.rdns === 'string';
}

/** The `window.ethereum` fallback entry, or null when there is none. */
export function injectedFallback(win: Window = window): ProviderDetail | null {
  const eth = (win as unknown as { ethereum?: unknown }).ethereum;
  if (!isProvider(eth)) return null;
  const flags = eth as { isMetaMask?: boolean; isRabby?: boolean; isCoinbaseWallet?: boolean };
  const name = flags.isRabby ? 'Rabby' : flags.isCoinbaseWallet ? 'Coinbase Wallet' : flags.isMetaMask ? 'MetaMask' : 'Browser wallet';
  return { info: { uuid: INJECTED_RDNS, name, icon: '', rdns: INJECTED_RDNS }, provider: eth };
}

/** The list a picker shows: announced wallets (by announcement order), plus the fallback when no announced wallet is it. */
export function mergeProviders(announced: readonly ProviderDetail[], fallback: ProviderDetail | null): ProviderDetail[] {
  const list = [...announced];
  if (fallback && !announced.some((d) => d.provider === fallback.provider)) list.push(fallback);
  return list;
}

/**
 * Listens for announcements and asks every wallet to announce itself. `onChange` gets the
 * full list (announced + fallback) each time it changes. Returns the unsubscribe function.
 */
export function discoverProviders(onChange: (list: ProviderDetail[]) => void, win: Window = window): () => void {
  const announced: ProviderDetail[] = [];
  const emit = () => onChange(mergeProviders(announced, injectedFallback(win)));
  const onAnnounce = (e: Event) => {
    const d = (e as AnnounceEvent).detail;
    if (!d || !validInfo(d.info) || !isProvider(d.provider)) return;
    const info: ProviderInfo = { uuid: d.info.uuid, name: d.info.name, icon: typeof d.info.icon === 'string' ? d.info.icon : '', rdns: d.info.rdns };
    // a wallet re-announces on every request: keep one entry per uuid (and per rdns)
    const at = announced.findIndex((x) => x.info.uuid === info.uuid || (info.rdns && x.info.rdns === info.rdns));
    if (at >= 0) announced[at] = { info, provider: d.provider };
    else announced.push({ info, provider: d.provider });
    emit();
  };
  win.addEventListener('eip6963:announceProvider', onAnnounce);
  win.dispatchEvent(new Event('eip6963:requestProvider'));
  // legacy wallets inject `window.ethereum` a moment after load
  emit();
  const late = win.setTimeout(emit, 500);
  const onInit = () => emit();
  win.addEventListener('ethereum#initialized', onInit);
  return () => {
    win.removeEventListener('eip6963:announceProvider', onAnnounce);
    win.removeEventListener('ethereum#initialized', onInit);
    win.clearTimeout(late);
  };
}

/** Announces `detail` the EIP-6963 way (now and on every later request). Tests and the dev wallet use it. */
export function announceProvider(detail: ProviderDetail, win: Window = window): () => void {
  const fire = () => win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ ...detail }) }));
  win.addEventListener('eip6963:requestProvider', fire);
  fire();
  return () => win.removeEventListener('eip6963:requestProvider', fire);
}
