import hardhatToolboxViemPlugin from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';

/**
 * Elymum contracts. Solidity 0.8.28, Shanghai, optimizer 200 runs.
 * Remappings for forge-std and OpenZeppelin live in remappings.txt (Hardhat 3 reads it).
 * Nothing else in the repository compiles Solidity.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
        settings: {
          evmVersion: 'shanghai',
          optimizer: { enabled: true, runs: 200 },
          // No metadata hash in the bytecode: the runtime code (and its pinned keccak256) depends only on the code
          // and these settings, not on comments, file paths or remappings.
          metadata: { bytecodeHash: 'none' },
        },
      },
    },
  },
  paths: {
    sources: './contracts',
    tests: { solidity: './test' },
  },
  test: {
    solidity: {
      fuzz: { runs: 512, seed: '0x454c594d554d' },
    },
  },
  networks: {
    localnet: { type: 'http', chainType: 'generic', url: 'http://127.0.0.1:8545' },
  },
});
