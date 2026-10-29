import { elymumArenaAbi, elymumNFTAbi } from '@elymum/contracts';
import {
  BaseError,
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  InsufficientFundsError,
  UserRejectedRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { ELYMUM_ERRORS_ABI, ERROR_MESSAGES, decodeRevertData, describeError, humanError } from '../src/errors';

function reverted(abi: typeof elymumArenaAbi | typeof elymumNFTAbi, errorName: string, args: unknown[] = []) {
  const data = encodeErrorResult({ abi, errorName, args } as never);
  const cause = new ContractFunctionRevertedError({ abi, data, functionName: 'join' } as never);
  return new ContractFunctionExecutionError(cause, { abi, functionName: 'join', args: [1] } as never);
}

describe('errors', () => {
  it('every custom error of both contracts has a message', () => {
    for (const e of ELYMUM_ERRORS_ABI) {
      if (/^(ERC721(Incorrect|Insufficient|Invalid(Approver|Operator|Owner|Receiver|Sender))|ERC2981InvalidToken|ERC20InvalidApprover|ERC20InvalidSender)/.test(e.name)) continue;
      expect(ERROR_MESSAGES[e.name], e.name).toBeTruthy();
    }
  });

  it('decodes arena and NFT custom errors through viem', () => {
    const d = describeError(reverted(elymumArenaAbi, 'ArenaFull'));
    expect(d).toMatchObject({ kind: 'contract', name: 'ArenaFull', message: ERROR_MESSAGES.ArenaFull });
    expect(describeError(reverted(elymumNFTAbi, 'NotAllowlisted')).name).toBe('NotAllowlisted');
    const own = describeError(reverted(elymumArenaAbi, 'OwnableUnauthorizedAccount', ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8']));
    expect(own.name).toBe('OwnableUnauthorizedAccount');
    expect(own.args).toEqual(['0x70997970C51812dc3A010C7d01b50e0d17dc79C8']);
  });

  it('decodes raw revert data from a wallet error object', () => {
    const data = encodeErrorResult({ abi: elymumNFTAbi, errorName: 'SoldOut' });
    expect(decodeRevertData(data)).toEqual({ name: 'SoldOut', args: [] });
    expect(describeError({ code: 3, message: 'execution reverted', data }).name).toBe('SoldOut');
    expect(describeError({ code: -32603, message: 'Internal', data: { code: 3, data } }).name).toBe('SoldOut');
    expect(decodeRevertData('0xdeadbeef')).toBeNull();
  });

  it('classifies wallet errors', () => {
    expect(describeError({ code: 4001, message: 'User rejected the request.' }).kind).toBe('rejected');
    expect(describeError(new UserRejectedRequestError(new Error('x'))).kind).toBe('rejected');
    expect(describeError({ code: 4902, message: 'Unrecognized chain ID' }, { chainName: 'Elysium Testnet' }).message).toMatch(/Elysium Testnet/);
    expect(describeError(new ChainMismatchError({ chain: { id: 99801, name: 'Elysium Testnet' } as never, currentChainId: 1 })).kind).toBe('wrong-chain');
    expect(describeError(new InsufficientFundsError({ cause: new BaseError('insufficient funds for gas * price + value') })).kind).toBe('insufficient-funds');
    expect(describeError({ code: -32002, message: 'Request already pending' }).kind).toBe('pending');
    expect(describeError(new Error('fetch failed')).kind).toBe('network');
    expect(describeError(new Error('execution reverted')).kind).toBe('revert');
    expect(describeError('weird').kind).toBe('unknown');
    expect(humanError({ code: 4001 })).toMatch(/declined/);
  });
});
