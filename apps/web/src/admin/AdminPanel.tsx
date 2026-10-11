import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SKINS, formatSol, shortAddress, type AdminSettings, type AdminSnapshot, type AdminStatus, type NftSettings, type TokenMintInspection, type TokenSettings } from '@solagel/shared';
import bs58 from 'bs58';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useUi } from '../store';
import { Logo, SkinCanvas, Switch } from '../ui/common';
import { ChainAdmin } from './ChainAdmin';
import { AdminApiError, adminApi, adminErrorMessage } from './api';
import './admin.css';

type Section = 'overview' | 'settings' | 'token' | 'nft' | 'chain' | 'activity';
type Session = { token: string; expiresAt: number; identity: string; wallet: string };
const sections: { id: Section; icon: string; label: string; eyebrow: string; title: string; description: string }[] = [
  { id: 'overview', icon: '◈', label: 'Overview', eyebrow: 'THE BIG PICTURE', title: 'A happy little control room.', description: 'Your arenas, players, and next chapters in one place.' },
  { id: 'settings', icon: '⚙', label: 'Game settings', eyebrow: 'KEEP THE POND BUSY', title: 'Set the pace.', description: 'Manage new entries and the bots that fill quiet rooms.' },
  { id: 'token', icon: '◎', label: 'Token', eyebrow: 'THE NEXT CHAPTER', title: 'A token of your own.', description: 'Register the mint after launch and inspect it on the server’s Solana network.' },
  { id: 'nft', icon: '✿', label: 'NFT skins', eyebrow: 'A LITTLE FURTHER AHEAD', title: 'New looks, same jelly.', description: 'Prepare cosmetic skin mappings for the future NFT collection.' },
  { id: 'chain', icon: '⛓', label: 'On-chain', eyebrow: 'WALLET-SIGNED CONTROLS', title: 'Manage the arena contract.', description: 'Review each change before signing it with the on-chain admin wallet.' },
  { id: 'activity', icon: '≋', label: 'Activity', eyebrow: 'EVERY CHANGE COUNTS', title: 'Follow the little details.', description: 'Review saved configuration changes and settlement activity.' },
];
const nftPreviewSkins = SKINS.filter(skin => skin.tier === 'premium');
const MAPPINGS_PER_PAGE = 20;

function SectionCard({ title, description, children, aside }: { title: string; description?: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="card admin-section"><div className="admin-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</div>{children}</section>;
}

function Feedback({ error, success }: { error: string; success: string }) {
  return <>{error && <div className="admin-error" role="alert">{error}</div>}{success && <div className="admin-success" role="status">✓ {success}</div>}</>;
}

function useAction(onUnauthorized: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async <T,>(action: () => Promise<T>, done: string): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true); setError(''); setSuccess('');
    try { const value = await action(); if (!mounted.current) return undefined; setSuccess(done); return value; }
    catch (e) {
      if (!mounted.current) return undefined;
      const message = adminErrorMessage(e);
      setError(message);
      if (e instanceof AdminApiError && (e.status === 401 || e.status === 403)) onUnauthorized(message);
      return undefined;
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy, error, success, run, setError, clearMessages: () => { setError(''); setSuccess(''); } };
}

/** Background refreshes may update untouched fields, but never erase an unsaved draft. */
function useDraft<T>(value: T, revision: number) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  const [baseRevision, setBaseRevision] = useState(revision);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const commit = (next: T, nextRevision: number) => { setDraft(next); setBase(next); setBaseRevision(nextRevision); };
  useEffect(() => {
    if (!dirty && baseRevision !== revision) { setDraft(value); setBase(value); setBaseRevision(revision); }
  }, [value, revision, baseRevision, dirty]);
  return { draft, setDraft, dirty, revision: baseRevision, stale: baseRevision !== revision, reset: () => commit(value, revision), commit };
}

function DraftActions({ dirty, stale, busy, blocked = false, reset, label = 'Save changes' }: { dirty: boolean; stale: boolean; busy: boolean; blocked?: boolean; reset: () => void; label?: string }) {
  return <>
    {stale && <div className="admin-notice">A newer saved version is available. Reload it before saving this draft.</div>}
    <div className="admin-actions"><button className="btn btn-gold" type="submit" disabled={!dirty || stale || busy || blocked}>{busy ? 'Saving…' : label}</button><button className="btn btn-ghost" type="button" onClick={reset} disabled={busy || (!dirty && !stale)}>Reload saved version</button>{dirty && <span className="admin-unsaved">Unsaved changes</span>}</div>
  </>;
}

type FormProps = { status: AdminStatus; save: (settings: AdminSettings, revision: number) => Promise<AdminSnapshot>; onUnauthorized: (message: string) => void };

function GameSettings({ status, save, onUnauthorized }: FormProps) {
  const form = useDraft({ admissionsPaused: status.settings.admissionsPaused, bots: status.settings.bots }, status.revision);
  const action = useAction(onUnauthorized);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await action.run(() => save({ ...status.settings, ...form.draft }, form.revision), 'Game settings saved. Existing games keep running.');
    if (saved) form.commit({ admissionsPaused: saved.settings.admissionsPaused, bots: saved.settings.bots }, saved.revision);
  };
  const botFields = [
    ['target', 'Public room population target', 'Desired humans plus bots, capped to each room’s player capacity.'],
    ['min', 'Private room minimum bots', 'Minimum bot population applies to private practice rooms only.'],
    ['max', 'Maximum public bots', 'Caps bots in public rooms without limiting human slots.'],
    ['privateTarget', 'Private room population target', 'Fills practice rooms created for friends.'],
  ] as const;
  return <SectionCard title="Room settings" description="Saved on the server and applied to the running game."><form onSubmit={submit}>
    <fieldset disabled={action.busy} className="admin-fieldset">
      <div className="admin-switch-row"><div><strong>Pause new entries</strong><p>Stops new practice, private, and SOL entries. Existing players can keep playing, reconnect to a surviving paid life, and cash out.</p></div><Switch on={form.draft.admissionsPaused} label="Pause new entries" onChange={(admissionsPaused) => form.setDraft({ ...form.draft, admissionsPaused })} /></div>
      <div className="admin-form-grid">{botFields.map(([key, title, hint]) => <label className="admin-field" key={key}><span>{title}</span><input className="input" type="number" min={0} max={100} step={1} required value={Number.isFinite(form.draft.bots[key]) ? form.draft.bots[key] : ''} onChange={e => form.setDraft({ ...form.draft, bots: { ...form.draft.bots, [key]: e.currentTarget.valueAsNumber } })} /><small>{hint}</small></label>)}</div>
      <div className="admin-notice">Bots in paid arenas give mass only, carry no SOL, and cannot eat human players. Public bots leave as humans fill the target population; lower targets retire bots gradually. The private minimum cannot exceed the private population target.</div>
      <DraftActions {...form} busy={action.busy} />
    </fieldset><Feedback {...action} />
  </form></SectionCard>;
}

function TokenSettingsPanel({ status, save, onUnauthorized, token }: FormProps & { token: string }) {
  const form = useDraft(status.settings.token, status.revision);
  const action = useAction(onUnauthorized);
  const inspectAction = useAction(onUnauthorized);
  const [inspection, setInspection] = useState<TokenMintInspection | null>(null);
  const visibleInspection = inspection?.mintAddress === form.draft.mintAddress ? inspection : null;
  const changedMint = form.draft.mintAddress !== status.settings.token.mintAddress;
  const needsInspection = !!form.draft.mintAddress && (changedMint || form.draft.decimals === null) && !visibleInspection;
  const inspect = async () => {
    const mintAddress = form.draft.mintAddress?.trim();
    if (!mintAddress) return;
    const result = await inspectAction.run(() => adminApi.inspectToken(token, mintAddress), 'Mint verified against the server RPC.');
    if (result) { setInspection(result); form.setDraft(current => current.mintAddress?.trim() === mintAddress ? { ...current, mintAddress, decimals: result.decimals } : current); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (needsInspection) { action.setError('Inspect the changed mint before saving.'); return; }
    const saved = await action.run(() => save({ ...status.settings, token: form.draft }, form.revision), 'Token configuration saved. Gameplay still uses SOL.');
    if (saved) form.commit(saved.settings.token, saved.revision);
  };
  return <>
    <div className="admin-notice admin-release-note"><span className="badge mint">1 · SOL BETA</span><span>→</span><span className="badge sky">2 · TOKEN</span><span>→</span><span className="badge pink">3 · NFT SKINS</span><p>The token comes before the NFT collection. Registering a mint does not enable token entry fees or token payouts; the current escrow supports SOL only.</p></div>
    <SectionCard title="Token launch details" description="Record the pump.fun token after it exists. No token is minted by this form."><form onSubmit={submit}>
      <fieldset className="admin-fieldset" disabled={action.busy || inspectAction.busy}>
        <label className="admin-field"><span>Solana mint address</span><div className="admin-input-action"><input className="input admin-mono" placeholder="Paste the token mint address" value={form.draft.mintAddress ?? ''} autoComplete="off" spellCheck={false} onChange={e => { form.setDraft({ ...form.draft, mintAddress: e.target.value.trim() || null, decimals: null }); setInspection(null); inspectAction.clearMessages(); }} /><button type="button" className="btn btn-sky" onClick={() => void inspect()} disabled={!form.draft.mintAddress}>{inspectAction.busy ? 'Inspecting…' : 'Inspect mint'}</button></div><small>The server checks the mint on {status.chain.cluster}. It never asks for a private key.</small></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Token symbol</span><input className="input" value={form.draft.symbol} maxLength={16} placeholder="e.g. GEL" onChange={e => form.setDraft({ ...form.draft, symbol: e.target.value })} /></label>
          <label className="admin-field"><span>Launch status</span><select className="input" value={form.draft.status} onChange={e => form.setDraft({ ...form.draft, status: e.target.value as TokenSettings['status'] })}><option value="planned">Planned</option><option value="configured">Configured</option><option value="launched">Launched — metadata only</option></select></label>
          <label className="admin-field"><span>Verified decimals</span><input className="input" readOnly value={form.draft.decimals ?? ''} placeholder="Inspect mint to verify" /></label>
          <label className="admin-field"><span>Launch page URL</span><input className="input" type="url" placeholder="https://pump.fun/…" value={form.draft.launchUrl ?? ''} onChange={e => form.setDraft({ ...form.draft, launchUrl: e.target.value || null })} /></label>
        </div>
        {needsInspection && <div className="admin-notice">The mint changed. Inspect it before saving this configuration.</div>}
        <DraftActions {...form} reset={() => { form.reset(); setInspection(null); inspectAction.clearMessages(); action.clearMessages(); }} busy={action.busy || inspectAction.busy} blocked={needsInspection} label="Save token details" />
      </fieldset><Feedback {...inspectAction} /><Feedback {...action} />
    </form></SectionCard>
    {visibleInspection && <SectionCard title="Mint inspection" aside={<span className="badge sky">{visibleInspection.cluster}</span>}><dl className="admin-detail-list"><div><dt>Token program</dt><dd>{visibleInspection.tokenProgram}</dd></div><div><dt>Decimals</dt><dd>{visibleInspection.decimals}</dd></div><div><dt>Supply (raw units)</dt><dd className="admin-mono">{visibleInspection.supply}</dd></div><div><dt>Mint authority</dt><dd className="admin-mono">{visibleInspection.mintAuthority ?? 'Revoked'}</dd></div><div><dt>Freeze authority</dt><dd className="admin-mono">{visibleInspection.freezeAuthority ?? 'Revoked'}</dd></div><div><dt>Extensions</dt><dd>{visibleInspection.extensions.length ? visibleInspection.extensions.join(', ') : 'None'}</dd></div></dl>{visibleInspection.warnings.map((warning, i) => <div key={i} className="admin-notice">{warning}</div>)}<div className="admin-notice">On-chain existence is verified. Token gameplay is not supported by the current arena contract.</div></SectionCard>}
  </>;
}

function NftSettingsPanel({ status, save, onUnauthorized }: FormProps) {
  const form = useDraft(status.settings.nft, status.revision);
  const action = useAction(onUnauthorized);
  const [mappingPage, setMappingPage] = useState(0);
  const mappingPages = Math.max(1, Math.ceil(form.draft.skinMappings.length / MAPPINGS_PER_PAGE));
  const currentMappingPage = Math.min(mappingPage, mappingPages - 1);
  const mappingStart = currentMappingPage * MAPPINGS_PER_PAGE;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const seen = new Set<string>();
    const invalid = form.draft.skinMappings.findIndex(mapping => {
      const asset = mapping.assetId.trim();
      if (!asset || seen.has(asset)) return true;
      seen.add(asset);
      return false;
    });
    if (invalid !== -1) {
      setMappingPage(Math.floor(invalid / MAPPINGS_PER_PAGE));
      action.setError(`Mapping ${invalid + 1} needs a unique, non-empty asset ID.`);
      return;
    }
    const saved = await action.run(() => save({ ...status.settings, nft: form.draft }, form.revision), 'NFT configuration saved as a staged preview. Ownership checks remain disabled.');
    if (saved) form.commit(saved.settings.nft, saved.revision);
  };
  const setMapping = (index: number, patch: Partial<NftSettings['skinMappings'][number]>) => form.setDraft({ ...form.draft, skinMappings: form.draft.skinMappings.map((m, i) => i === index ? { ...m, ...patch } : m) });
  return <SectionCard title="Future NFT collection" description="Contracts and ownership integration come later, after the token." aside={<span className="badge pink">STAGED ONLY</span>}><form onSubmit={submit}>
    <fieldset className="admin-fieldset" disabled={action.busy}>
      <div className="admin-notice">The planned free mint on OpenSea will provide cosmetic character skins. These settings do not deploy a contract, start a mint, grant ownership, or unlock skins for players.</div>
      <div className="admin-form-grid">
        <label className="admin-field"><span>Collection chain</span><select className="input" value={form.draft.chain} onChange={e => form.setDraft({ ...form.draft, chain: e.target.value as NftSettings['chain'], standard: 'unconfigured' })}><option value="unconfigured">Not selected</option><option value="solana">Solana</option><option value="ethereum">Ethereum</option><option value="base">Base</option><option value="polygon">Polygon</option></select></label>
        <label className="admin-field"><span>Token standard</span><select className="input" value={form.draft.standard} onChange={e => form.setDraft({ ...form.draft, standard: e.target.value as NftSettings['standard'] })}><option value="unconfigured">Not selected</option>{form.draft.chain === 'solana' ? <option value="metaplex">Metaplex</option> : form.draft.chain !== 'unconfigured' ? <><option value="erc721">ERC-721</option><option value="erc1155">ERC-1155</option></> : null}</select></label>
        <label className="admin-field"><span>Collection / contract address</span><input className="input admin-mono" value={form.draft.collectionAddress ?? ''} autoComplete="off" spellCheck={false} placeholder="Add after deployment" onChange={e => form.setDraft({ ...form.draft, collectionAddress: e.target.value.trim() || null })} /></label>
        <label className="admin-field"><span>OpenSea collection URL</span><input className="input" type="url" value={form.draft.openSeaUrl ?? ''} placeholder="https://opensea.io/collection/…" onChange={e => form.setDraft({ ...form.draft, openSeaUrl: e.target.value || null })} /></label>
        <label className="admin-field"><span>Configuration status</span><select className="input" value={form.draft.status} onChange={e => form.setDraft({ ...form.draft, status: e.target.value as NftSettings['status'] })}><option value="planned">Planned</option><option value="configured">Configured — staged only</option></select></label>
      </div>
      <div className="admin-section-heading"><div><h3>Character mappings</h3><p>Each unique asset ID maps to a preview character. Several assets may share a character. Up to 1,000 mappings.</p></div><button className="btn btn-sm btn-ghost" type="button" disabled={form.draft.skinMappings.length >= 1000} onClick={() => { setMappingPage(Math.floor(form.draft.skinMappings.length / MAPPINGS_PER_PAGE)); form.setDraft({ ...form.draft, skinMappings: [...form.draft.skinMappings, { skinId: nftPreviewSkins[0].id, assetId: '' }] }); }}>+ Add mapping</button></div>
      {!form.draft.skinMappings.length && <div className="admin-empty">No character mappings yet. Your starter and XP skins keep working as usual.</div>}
      <div className="admin-mappings">{form.draft.skinMappings.slice(mappingStart, mappingStart + MAPPINGS_PER_PAGE).map((mapping, offset) => { const index = mappingStart + offset; return <div className="admin-mapping" key={index}><SkinCanvas skin={mapping.skinId} size={64} animate={false} /><label className="admin-field"><span>Character</span><select className="input" aria-label={`Character for mapping ${index + 1}`} value={mapping.skinId} onChange={e => setMapping(index, { skinId: Number(e.target.value) })}>{nftPreviewSkins.map(skin => <option key={skin.id} value={skin.id}>{skin.name.en}</option>)}</select></label><label className="admin-field"><span>Asset / token ID</span><input className="input admin-mono" required value={mapping.assetId} aria-label={`Asset ID for mapping ${index + 1}`} placeholder={form.draft.chain === 'solana' ? 'Asset mint address' : 'Token ID'} onChange={e => setMapping(index, { assetId: e.target.value })} /></label><button className="btn btn-sm btn-ghost" type="button" aria-label={`Remove mapping ${index + 1}`} onClick={() => form.setDraft({ ...form.draft, skinMappings: form.draft.skinMappings.filter((_, i) => i !== index) })}>Remove</button></div>; })}</div>
      {mappingPages > 1 && <div className="admin-actions admin-pagination"><button className="btn btn-sm btn-ghost" type="button" disabled={currentMappingPage === 0} onClick={() => setMappingPage(currentMappingPage - 1)}>← Previous</button><span>Page {currentMappingPage + 1} of {mappingPages} · {form.draft.skinMappings.length} mappings</span><button className="btn btn-sm btn-ghost" type="button" disabled={currentMappingPage === mappingPages - 1} onClick={() => setMappingPage(currentMappingPage + 1)}>Next →</button></div>}
      <DraftActions {...form} busy={action.busy} label="Save staged collection" />
    </fieldset><Feedback {...action} />
  </form></SectionCard>;
}

function Overview({ status, setSection, retry, retryBusy }: { status: AdminStatus; setSection: (tab: Section) => void; retry: () => void; retryBusy: boolean }) {
  const humans = status.rooms.reduce((n, r) => n + r.players, 0);
  const bots = status.rooms.reduce((n, r) => n + r.bots, 0);
  return <>
    <div className="admin-metrics">{[
      ['✦', status.online, 'Connected users', 'pink'], ['◉', humans, 'Humans in rooms', 'mint'], ['◈', bots, 'Active bots', 'sky'], ['↗', status.journal.pending.length, 'Pending records / payouts', 'gold'],
    ].map(([icon, value, label, color]) => <div className={`card admin-metric ${color}`} key={label}><span aria-hidden="true">{icon}</span><strong>{value}</strong><small>{label}</small></div>)}</div>
    <div className="admin-overview-grid"><SectionCard title="The pond right now" description={`${status.rooms.length} active room${status.rooms.length === 1 ? '' : 's'}`} aside={<span className={`badge ${status.settings.admissionsPaused ? 'pink' : 'mint'}`}>{status.settings.admissionsPaused ? 'ENTRIES PAUSED' : 'ENTRIES OPEN'}</span>}>
      {status.rooms.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Room</th><th>Humans</th><th>Bots</th><th>Mode</th></tr></thead><tbody>{status.rooms.map(room => <tr key={room.id}><td><strong>{room.name}</strong><small>{room.players} / {room.maxPlayers} human slots</small></td><td>{room.players}</td><td>{room.bots}</td><td><span className="badge">{room.mode === 'stake' ? 'SOL' : room.mode === 'private' ? 'PRIVATE' : 'PRACTICE'}</span></td></tr>)}</tbody></table></div> : <div className="admin-empty">No active rooms yet.</div>}
      <button className="btn btn-sm btn-ghost" onClick={() => setSection('settings')}>Manage room settings →</button>
    </SectionCard><SectionCard title="Next chapters" description="Launch the token first. Bring NFT skins later."><div className="admin-chapter"><span className="admin-chapter-icon sky">◎</span><div><h3>Game token</h3><p>{status.settings.token.symbol || 'No symbol configured'} · {status.settings.token.status}</p></div><button className="btn btn-sm btn-ghost" onClick={() => setSection('token')}>Manage</button></div><div className="admin-chapter"><span className="admin-chapter-icon pink">✿</span><div><h3>NFT character skins</h3><p>{status.settings.nft.skinMappings.length} staged mappings · {status.settings.nft.status}</p></div><button className="btn btn-sm btn-ghost" onClick={() => setSection('nft')}>Prepare</button></div><div className="admin-notice">SOL entry and settlement stay active independently of future token and NFT configuration.</div></SectionCard></div>
    <SectionCard title="Settlement health" description="Retry only payouts and records already in the durable queue." aside={<span className={`badge ${status.journal.healthy ? 'mint' : 'pink'}`}>{status.journal.healthy ? 'STORAGE HEALTHY' : 'STORAGE UNHEALTHY'}</span>}><div className="admin-health-grid"><div><strong>{status.journal.live.length}</strong><span>Live paid sessions</span></div><div><strong>{status.journal.pending.length}</strong><span>Queued settlements / records</span></div><div><strong>{status.journal.receipts.length}</strong><span>Retained payout receipts</span></div><div><strong>{status.chain.stakeEnabled ? 'Online' : 'Offline'}</strong><span>SOL arenas · {status.chain.cluster}</span></div></div><div className="admin-actions"><button className="btn btn-sky" onClick={retry} disabled={retryBusy || !status.journal.healthy || !status.journal.pending.length}>{retryBusy ? 'Requesting retry…' : 'Retry queued settlements'}</button><span className="muted small">Uses existing validated amounts. No new payout is created.</span></div>{!status.journal.healthy && <div className="admin-error">The settlement journal needs attention. New paid entries and retries must remain blocked until storage is healthy.</div>}</SectionCard>
  </>;
}

const dateTime = (at: number) => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

function Activity({ status }: { status: AdminStatus }) {
  return <>
    <SectionCard title="Configuration activity" description="Most recent changes first. Times are shown in UTC.">{status.audit.length ? <ol className="admin-audit">{[...status.audit].sort((a, b) => b.at - a.at).map((entry, i) => <li key={`${entry.at}-${entry.revision}-${i}`}><span className="admin-audit-dot" /><div><strong>{entry.summary || entry.action}</strong><small>{dateTime(entry.at)} · {shortAddress(entry.wallet)} · Revision {entry.revision}</small><span className="admin-mono">{entry.action}</span></div></li>)}</ol> : <div className="admin-empty">No admin changes have been recorded yet.</div>}</SectionCard>
    <SectionCard title="Pending settlement queue" description="Includes on-chain game records and SOL payouts.">{status.journal.pending.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Player</th><th>Kind</th><th>Gross amount</th><th>Attempts</th><th>Next retry / last error</th></tr></thead><tbody>{status.journal.pending.map((item, i) => <tr key={`${item.key}-${i}`}><td className="admin-mono" title={item.player}>{shortAddress(item.player)}</td><td>{item.kind}</td><td>{item.payout === undefined ? '—' : formatSol(item.payout, 6)}</td><td>{item.attempts}</td><td>{dateTime(item.nextAttemptAt)}{item.lastError && <small>{item.lastError}</small>}</td></tr>)}</tbody></table></div> : <div className="admin-empty">The queue is clear. A quiet moment for the coins.</div>}</SectionCard>
    <SectionCard title="Recent payout receipts" description="Recorded gross arena balances before any profit fee.">{status.journal.receipts.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Player</th><th>Arena</th><th>Gross balance</th><th>Settled at (UTC)</th><th>Signature</th></tr></thead><tbody>{[...status.journal.receipts].sort((a, b) => b.settledAt - a.settledAt).slice(0, 30).map(receipt => <tr key={receipt.signature}><td title={receipt.player}>{shortAddress(receipt.player)}</td><td>#{receipt.arenaId}</td><td>{formatSol(receipt.payout, 6)}</td><td>{dateTime(receipt.settledAt)}</td><td className="admin-mono" title={receipt.signature}>{shortAddress(receipt.signature)}</td></tr>)}</tbody></table></div> : <div className="admin-empty">No retained payout receipts.</div>}</SectionCard>
  </>;
}

function AuthorizedPanel({ session, onExpire, section, setSection }: { session: Session; onExpire: (message: string) => void; section: Section; setSection: (section: Section) => void }) {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadSequence = useRef(0);
  const retryAction = useAction(onExpire);
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    try { const next = await adminApi.status(session.token, signal); if (!signal?.aborted && sequence === loadSequence.current) { setStatus(current => current && next.revision < current.revision ? current : next); setError(''); } }
    catch (e) { if (signal?.aborted || sequence !== loadSequence.current) return; const message = adminErrorMessage(e); setError(message); if (e instanceof AdminApiError && (e.status === 401 || e.status === 403)) onExpire(message); }
    finally { if (!signal?.aborted && sequence === loadSequence.current) { setLoading(false); setRefreshing(false); } }
  }, [session.token, onExpire]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void load(controller.signal); }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  const save = async (settings: AdminSettings, revision: number) => {
    try {
      const snapshot = await adminApi.save(session.token, revision, settings);
      setStatus(current => current && current.revision <= snapshot.revision ? { ...current, ...snapshot } : current);
      return snapshot;
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) await load();
      throw error;
    }
  };
  if (loading) return <div className="card admin-loading" role="status"><span className="spin" /> Opening the control room…</div>;
  if (!status) return <div className="card admin-section"><div className="admin-error" role="alert">{error || 'The admin server is unavailable.'}</div><button className="btn btn-gold" disabled={refreshing} onClick={() => { setRefreshing(true); void load(); }}>{refreshing ? 'Retrying…' : 'Try again'}</button></div>;
  const props = { status, save, onUnauthorized: onExpire };
  return <>
    <div className="admin-status-line"><span><span className={`dot ${status.journal.healthy ? '' : 'off'}`} /> {status.chain.cluster} <span className="admin-status-divider">/</span> Saved revision {status.revision}</span><button className="btn btn-sm btn-ghost" disabled={refreshing} onClick={() => { setRefreshing(true); void load(); }}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button></div>
    {error && <div className="admin-error" role="alert">{error} Showing the last successful snapshot.</div>}
    <Feedback {...retryAction} />
    <div className="admin-tab-panel" hidden={section !== 'overview'}><Overview status={status} setSection={setSection} retryBusy={retryAction.busy} retry={() => void retryAction.run(async () => { await adminApi.retrySettlements(session.token); await load(); }, 'Queued settlements have been scheduled for another attempt.')} /></div>
    <div className="admin-tab-panel" hidden={section !== 'settings'}><GameSettings {...props} /></div>
    <div className="admin-tab-panel" hidden={section !== 'token'}><TokenSettingsPanel {...props} token={session.token} /></div>
    <div className="admin-tab-panel" hidden={section !== 'nft'}><NftSettingsPanel {...props} /></div>
    <div className="admin-tab-panel" hidden={section !== 'chain'}><ChainAdmin /></div>
    <div className="admin-tab-panel" hidden={section !== 'activity'}><Activity status={status} /></div>
  </>;
}

export function AdminPanel() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const chain = useUi(s => s.chain);
  const address = wallet.publicKey?.toBase58() ?? '';
  const identity = `${address}|${connection.rpcEndpoint}|${chain?.cluster ?? ''}|${chain?.programId ?? ''}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [section, setSection] = useState<Section>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choosingWallet, setChoosingWallet] = useState(false);
  const currentSession = session?.identity === identity && session.expiresAt > Date.now() ? session : null;
  const currentSection = sections.find(s => s.id === section)!;
  const loginFlight = useRef(false);
  useEffect(() => { setSession(null); setError(''); setBusy(false); loginFlight.current = false; }, [identity]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => { if (sessionRef.current?.token !== session.token) return; setSession(null); setError('Your admin session expired. Sign in again to continue.'); }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);
  const expire = useCallback((message: string) => { if (sessionRef.current?.token !== session?.token || identityRef.current !== session?.identity) return; setSession(null); setError(message); }, [session?.token, session?.identity]);
  const signIn = async () => {
    if (!address || !wallet.signMessage || loginFlight.current) return;
    const startedIdentity = identity;
    loginFlight.current = true; setBusy(true); setError('');
    try {
      const challenge = await adminApi.challenge(address);
      if (identityRef.current !== startedIdentity) return;
      const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));
      if (identityRef.current !== startedIdentity) return;
      const result = await adminApi.signIn(address, challenge.message, bs58.encode(signature));
      if (identityRef.current === startedIdentity) { setSession({ ...result, identity: startedIdentity, wallet: address }); setChoosingWallet(false); }
    } catch (e) { if (identityRef.current === startedIdentity) setError(adminErrorMessage(e)); }
    finally { if (identityRef.current === startedIdentity) { setBusy(false); loginFlight.current = false; } }
  };
  const availableWallets = wallet.wallets.filter(w => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const disconnect = async () => { setSession(null); setError(''); try { await wallet.disconnect(); } catch (e) { setError(adminErrorMessage(e)); } };
  return <div className="admin-page">
    <aside className="admin-sidebar"><a href="/" className="admin-brand"><Logo /><span>CONTROL ROOM</span></a><div className="admin-nav-label">YOUR LITTLE WORLD</div><nav aria-label="Admin sections">{sections.map(item => <button key={item.id} className={`admin-nav-item ${section === item.id ? 'active' : ''}`} aria-current={section === item.id ? 'page' : undefined} disabled={!currentSession} onClick={() => setSection(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.id === 'nft' && <span className="admin-nav-tag">LATER</span>}</button>)}</nav><div className="admin-sidebar-bottom"><SkinCanvas skin={0} size={108} expression="happy" /><strong>A little care goes a long way.</strong><p>Keep the pond playful.</p><a href="/" className="btn btn-sm btn-ghost">← Back to the game</a></div></aside>
    <main className="admin-main"><header className="admin-topbar"><div className="admin-breadcrumb">Solagel <span>/</span> Admin <span>/</span> {currentSection.label}</div><div className="admin-actions"><span className="badge mint">SOL BETA</span>{address ? <><span className="admin-wallet" title={address}>◉ {shortAddress(address)}</span><button className="btn btn-sm btn-ghost" onClick={() => void disconnect()}>Disconnect</button>{currentSession && <button className="btn btn-sm btn-ghost" onClick={() => setSession(null)}>Sign out</button>}</> : <button className="btn btn-sm btn-purple" onClick={() => setChoosingWallet(true)} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting…' : 'Connect wallet'}</button>}</div></header>
      <div className="admin-page-heading"><div><span className="admin-eyebrow">{currentSection.eyebrow}</span><h1>{currentSection.title}</h1><p>{currentSection.description}</p></div><span className="admin-heading-spark" aria-hidden="true">✦</span></div>
      {currentSession ? <AuthorizedPanel key={currentSession.token} session={currentSession} onExpire={expire} section={section} setSection={setSection} /> : <section className="card admin-login"><div className="admin-login-mascot"><SkinCanvas skin={0} size={146} expression="happy" /></div><span className="badge lav">ADMIN ACCESS</span><h2>A familiar wallet. A special key.</h2><p>Connect an authorized wallet, then sign a dedicated admin message. This does not send a transaction or spend SOL.</p>{error && <div className="admin-error" role="alert">{error}</div>}{address ? <><div className="admin-login-address admin-mono">{address}</div><button className="btn btn-gold" disabled={busy || !wallet.signMessage} onClick={() => void signIn()}>{busy ? 'Check your wallet…' : 'Sign in as admin'}</button>{!wallet.signMessage && <div className="admin-error">This wallet cannot sign messages. Connect a wallet that supports message signing.</div>}</> : <button className="btn btn-purple" onClick={() => setChoosingWallet(true)} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting wallet…' : 'Choose a wallet'}</button>}{choosingWallet && !address && <div className="admin-wallet-list">{availableWallets.length ? availableWallets.map(item => <button key={item.adapter.name} className="wallet-item" onClick={() => { wallet.select(item.adapter.name); setChoosingWallet(false); }}><img src={item.adapter.icon} alt="" />{item.adapter.name}<span className="badge mint tag">Detected</span></button>) : <div className="admin-notice">No compatible Solana wallet was detected. Open this page in a wallet browser, or install a Solana wallet extension, then reload.</div>}</div>}<div className="admin-login-footnote">Only configured admin wallets or the contract’s current admin can enter. Sessions stay in this tab’s memory and clear when the wallet or network changes.</div></section>}
      <footer className="admin-footer"><span>Solagel control room · A little order for your jelly world.</span><span>Token first. NFT skins later.</span></footer>
    </main>
  </div>;
}
