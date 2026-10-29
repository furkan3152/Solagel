import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { Sheet, type SheetProps } from './Sheet';

export type ModalProps = SheetProps;

/**
 * A dialog sticker: centred on desktop, a bottom sheet on phones. Same
 * behaviour as `Sheet` (focus trap, Esc, scrim, focus restore); the name
 * screens reach for.
 */
export function Modal(props: ModalProps) {
  return <Sheet {...props} className={`kb-modal${props.className ? ` ${props.className}` : ''}`} />;
}

export interface WalletOption {
  /** EIP-6963 rdns or any stable id. */
  id: string;
  name: string;
  /** EIP-6963 icon (a data: URI) or any node. */
  icon?: string | ReactNode;
  /** Announced by the browser (EIP-6963), so it will open right away. */
  detected?: boolean;
  /** Short note, e.g. "Recent". */
  note?: string;
}

export interface WalletPickerProps {
  open: boolean;
  onClose: () => void;
  wallets: WalletOption[];
  onPick: (id: string) => void;
  /** The wallet being opened (shows a busy coin, blocks other picks). */
  busyId?: string | null;
  /** Error from the last attempt. */
  error?: ReactNode;
  title?: ReactNode;
  kicker?: ReactNode;
  closeLabel?: string;
  /** Shown when no wallet was detected. */
  empty?: ReactNode;
  /** Footnote (default: the seed-phrase line). */
  footnote?: ReactNode;
}

/** The connect dialog: a list of wallet stickers (EIP-6963 icons), detected ones first. */
export function WalletPicker({
  open,
  onClose,
  wallets,
  onPick,
  busyId = null,
  error,
  title = 'Pick a wallet',
  kicker = 'Connect · Elysium',
  closeLabel = 'Close',
  empty = 'No wallet found in this browser. Install one that supports Elysium, then come back.',
  footnote = 'We only ask you to sign a message. We will never ask for your seed phrase. Nobody should.',
}: WalletPickerProps) {
  const sorted = [...wallets].sort((a, b) => Number(!!b.detected) - Number(!!a.detected));
  return (
    <Sheet open={open} onClose={onClose} title={title} kicker={kicker} closeLabel={closeLabel} className="kb-wallets">
      {sorted.length === 0 ? (
        <p className="kb-wallets__empty">{empty}</p>
      ) : (
        <ul className="kb-wallets__list">
          {sorted.map((w) => {
            const busy = busyId === w.id;
            return (
              <li key={w.id}>
                <button type="button" className={`kb-wallet${busy ? ' is-busy' : ''}`} onClick={() => onPick(w.id)} disabled={busyId !== null && !busy} aria-busy={busy || undefined}>
                  <span className="kb-wallet__icon" aria-hidden="true">
                    {typeof w.icon === 'string' ? <img src={w.icon} alt="" width={32} height={32} /> : (w.icon ?? <Icon name="wallet" size={22} />)}
                  </span>
                  <span className="kb-wallet__name">{w.name}</span>
                  {w.note && <span className="kb-wallet__note">{w.note}</span>}
                  {w.detected && <span className="kb-wallet__tag">Detected</span>}
                  {busy ? <span className="kb-btn__busy kb-wallet__busy" aria-hidden="true" /> : <Icon name="chevron" size={18} className="kb-wallet__go" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error != null && (
        <p className="kb-wallets__error" role="alert">
          {error}
        </p>
      )}
      {footnote != null && <p className="kb-wallets__foot">{footnote}</p>}
    </Sheet>
  );
}
