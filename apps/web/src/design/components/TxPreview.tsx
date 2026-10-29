import { useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { AddressChip } from './AddressChip';
import { Button } from './Button';
import { HypeAmount } from './HypeAmount';
import { StatusPill } from './StatusPill';

export interface TxArg {
  name: string;
  /** Solidity type, e.g. "address", "uint256", "bytes32". */
  type: string;
  /** Display value. Strings starting with 0x render as an AddressChip. */
  value: ReactNode;
}

export interface TxPreviewProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Function name, e.g. "setToken". */
  fn: string;
  /** The contract called. */
  contract?: { name: string; address: string };
  args: TxArg[];
  /** HYPE sent with the call (payable), in wei. Omit / null for none. */
  value?: { wei: bigint; usd?: number | null } | null;
  /** The chain the wallet will sign on. `mainnet` adds the red badge. */
  network: { name: string; chainId: number; mainnet?: boolean };
  /** The signing account. */
  from?: string;
  /** A warning or explanation shown above the buttons. */
  note?: ReactNode;
  title?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Opens the wallet. While it runs (or while `busy`) the button is locked, so
   * a double click can never send twice. A returned promise keeps the lock until it settles.
   */
  onConfirm: () => void | Promise<unknown>;
  onCancel?: () => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * What the admin is about to sign, shown before every wallet prompt (spec §5):
 * the call as a signature line, an arguments table (name, type, value), the
 * HYPE value, the network and the signer, then Cancel / Confirm.
 */
export function TxPreview({
  fn,
  contract,
  args,
  value,
  network,
  from,
  note,
  title = 'Check it before your wallet does',
  confirmLabel = 'Open wallet',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
  disabled = false,
  className,
  ...rest
}: TxPreviewProps) {
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const locked = busy || sending;
  const confirm = async () => {
    if (lock.current || busy || disabled) return;
    lock.current = true;
    setSending(true);
    try {
      await onConfirm();
    } finally {
      lock.current = false;
      setSending(false);
    }
  };
  const sig = `${fn}(${args.map((a) => `${a.type} ${a.name}`).join(', ')})`;
  return (
    <section {...rest} className={`kb-tx${network.mainnet ? ' is-mainnet' : ''}${className ? ` ${className}` : ''}`} aria-label={typeof title === 'string' ? title : 'Transaction preview'}>
      <header className="kb-tx__head">
        <div>
          <div className="kb-tx__kicker">Transaction preview</div>
          <h3 className="kb-tx__title">{title}</h3>
        </div>
        <StatusPill tone={network.mainnet ? 'mainnet' : 'testnet'} size="sm">
          {network.name} · {network.chainId}
        </StatusPill>
      </header>
      <div className="kb-tx__sig">
        {contract && <span className="kb-tx__contract">{contract.name}.</span>}
        <span className="kb-tx__fn">{sig}</span>
      </div>
      <table className="kb-tx__args">
        <thead>
          <tr>
            <th scope="col">Argument</th>
            <th scope="col">Type</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {args.length === 0 && (
            <tr>
              <td colSpan={3} className="kb-tx__none">
                No arguments
              </td>
            </tr>
          )}
          {args.map((a) => (
            <tr key={a.name}>
              <th scope="row">{a.name}</th>
              <td className="kb-tx__type">{a.type}</td>
              <td className="kb-tx__val">
                {typeof a.value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a.value) ? <AddressChip address={a.value} size="sm" chars={6} /> : a.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="kb-tx__meta">
        <div>
          <dt>Value</dt>
          <dd>{value && value.wei > 0n ? <HypeAmount wei={value.wei} usd={value.usd} size="sm" decimals={6} /> : <span className="kb-tx__zero">0 HYPE</span>}</dd>
        </div>
        {contract && (
          <div>
            <dt>To</dt>
            <dd>
              <AddressChip address={contract.address} size="sm" />
            </dd>
          </div>
        )}
        {from && (
          <div>
            <dt>From</dt>
            <dd>
              <AddressChip address={from} size="sm" />
            </dd>
          </div>
        )}
      </dl>
      {note != null && <div className="kb-tx__note">{note}</div>}
      <div className="kb-tx__actions">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={locked}>
            {cancelLabel}
          </Button>
        )}
        <Button variant={network.mainnet ? 'danger' : 'primary'} icon="wallet" onClick={confirm} loading={locked} disabled={disabled}>
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
