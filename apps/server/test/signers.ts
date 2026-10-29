import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/** A fresh EOA that signs SIWE messages like a browser wallet (`personal_sign`). */
export function testSigner(key = generatePrivateKey()) {
  const account = privateKeyToAccount(key);
  return {
    account,
    /** EIP-55 checksummed. */
    address: account.address as string,
    sign: (message: string) => account.signMessage({ message }),
  };
}

export type TestSigner = ReturnType<typeof testSigner>;
