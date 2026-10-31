import { explorerAddressUrl, explorerTxUrl } from '@elymum/shared';
import { useUi } from '../store';

/** Explorer links on the server's chain (Blockscout layout); null when the chain has no explorer. */
export const explorerTx = (hash: string, explorerUrl: string | null | undefined = useUi.getState().chain?.explorerUrl): string | null =>
  /^0x[0-9a-fA-F]{64}$/.test(hash) ? explorerTxUrl(explorerUrl, hash) : null;

export const explorerAddress = (address: string, explorerUrl: string | null | undefined = useUi.getState().chain?.explorerUrl): string | null =>
  explorerAddressUrl(explorerUrl, address);
