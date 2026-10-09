import { Buffer } from 'buffer';

// @solana/web3.js and @anchor-lang/core expect Node's Buffer on the global object.
const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
g.Buffer ??= Buffer;
g.process ??= { env: {} };
