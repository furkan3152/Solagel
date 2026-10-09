import { explorerAddressUrl, explorerTxUrl } from '@solagel/sdk';
import { useUi } from '../store';

const localRpc = () => useUi.getState().chain?.rpcUrl ?? 'http://127.0.0.1:8899';

export const explorerTx = (signature: string, cluster: string): string => explorerTxUrl(signature, cluster, localRpc());
export const explorerAddress = (address: string, cluster: string): string => explorerAddressUrl(address, cluster, localRpc());
