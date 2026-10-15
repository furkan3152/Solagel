import { readFileSync } from 'node:fs';
import { SendTransactionError } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { SESSION_IN_USE_MESSAGE, SLANA_ERRORS, SlanaErrorCode, TransactionFailedError, describeError, programErrorCode } from '../src';

const PROGRAM = '5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472';

describe('programErrorCode / describeError', () => {
  it('maps a fake Custom(6007) log to InsufficientPot', () => {
    const err = {
      message: 'Transaction simulation failed',
      logs: [`Program ${PROGRAM} invoke [1]`, `Program ${PROGRAM} failed: InstructionError(1, Custom(6007))`],
    };
    expect(programErrorCode(err)).toBe(6007);
    expect(describeError(err)).toEqual({ code: 6007, name: 'InsufficientPot', message: SLANA_ERRORS[6007].message });
  });

  it('v2 codes: Pass, mint and seed errors', () => {
    expect(SlanaErrorCode.MintNotAllowed).toBe(6020);
    expect(SlanaErrorCode.PassInUse).toBe(6025);
    expect(SlanaErrorCode.EntryFeeZero).toBe(6040);
    expect(SlanaErrorCode.SeedLocked).toBe(6041);
    expect(SlanaErrorCode.MintStillOpen).toBe(6042);
    expect(describeError({ code: 6042, msg: 'Pass mint is still open' }).name).toBe('MintStillOpen');
    expect([SlanaErrorCode.MintEnded, SlanaErrorCode.SupplyLocked, SlanaErrorCode.UseCloseMint, SlanaErrorCode.BadSlotHashes, SlanaErrorCode.NothingMinted, SlanaErrorCode.EntropyNotReady, SlanaErrorCode.EntropyNotCaptured, SlanaErrorCode.SeedNotRevealed, SlanaErrorCode.FeeAboveLimit]).toEqual([6043, 6044, 6045, 6046, 6047, 6048, 6049, 6050, 6051]);
    expect([SlanaErrorCode.EntryFeeAboveLimit, SlanaErrorCode.SettleFeeAboveLimit, SlanaErrorCode.SessionFinalized, SlanaErrorCode.InvalidAuthority]).toEqual([6052, 6053, 6054, 6055]);
    // deprecated but kept: later codes keep their numbers
    expect(SlanaErrorCode.MintSoldOut).toBe(6027);
    expect(describeError({ code: 6022, msg: 'x' }).name).toBe('PassRequired');
  });

  it('"already in use" on a pass_lock address maps to PassInUse', () => {
    const lock = 'Lock1111111111111111111111111111111111111111';
    const session = 'Sess1111111111111111111111111111111111111111';
    const inUse = (address: string) => ({
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        'Program 11111111111111111111111111111111 invoke [2]',
        `Allocate: account Address { address: ${address}, base: None } already in use`,
        'Program 11111111111111111111111111111111 failed: custom program error: 0x0',
      ],
    });
    expect(describeError(inUse(lock), { passLock: lock })).toEqual({ code: SlanaErrorCode.PassInUse, name: 'PassInUse', message: 'This Pass is already backing another open session.' });
    // another account already in use stays generic
    expect(describeError(inUse(session), { passLock: lock }).name).toBe('AccountAlreadyInUse');
    expect(describeError(inUse(lock)).name).toBe('AccountAlreadyInUse');
    // "already in use" on the join's session PDA: a (maybe finalized) session is still open
    expect(describeError(inUse(session), { passLock: lock, session })).toMatchObject({ name: 'SessionInUse', message: SESSION_IN_USE_MESSAGE });
    // Anchor names the account in its log
    expect(describeError({ message: 'AnchorError caused by account: pass_lock. already in use' }).name).toBe('PassInUse');
  });

  it('reads Anchor log lines, hex custom codes and JSON confirmation errors', () => {
    const anchorLog = {
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        'Program log: AnchorError thrown in programs/slana-ref/src/instructions/settle_session.rs:72. Error Code: SessionMismatch. Error Number: 6019. Error Message: Settlement is for a different session.',
        `Program ${PROGRAM} failed: custom program error: 0x1783`,
      ],
    };
    expect(describeError(anchorLog).name).toBe('SessionMismatch');
    expect(programErrorCode('Error processing Instruction 0: custom program error: 0x1777')).toBe(6007);
    expect(programErrorCode(new TransactionFailedError('sig', { InstructionError: [1, { Custom: 6016 }] }, undefined))).toBe(6016);
    expect(programErrorCode({ err: { InstructionError: [0, { Custom: 6005 }] } })).toBe(6005);
    expect(programErrorCode(new Error('failed ({"err":{"InstructionError":[2,{"Custom":6010}]}})'))).toBe(6010);
    // Anchor's own error objects
    expect(programErrorCode({ error: { errorCode: { code: 'ArenaFull', number: 6010 }, errorMessage: 'Arena is full' } })).toBe(6010);
    expect(programErrorCode({ code: 6012, msg: 'Session cannot be refunded yet' })).toBe(6012);
    // wallet adapters wrap the original error
    expect(describeError({ name: 'WalletSendTransactionError', message: 'Unexpected error', error: { logs: anchorLog.logs } }).code).toBe(6019);
  });

  it('reads SendTransactionError simulation logs', () => {
    const err = new SendTransactionError({
      action: 'simulate',
      signature: '',
      transactionMessage: 'Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1778',
      logs: [`Program ${PROGRAM} invoke [1]`, 'Program log: AnchorError occurred. Error Code: ArenaDisabled. Error Number: 6005. Error Message: x.'],
    });
    // the Anchor log line wins over the summary
    expect(programErrorCode(err)).toBe(6005);
  });

  it('recognises common wallet / network failures', () => {
    expect(describeError(new Error('User rejected the request.')).name).toBe('UserRejected');
    expect(describeError({ code: 4001, message: 'whatever' }).name).toBe('UserRejected');
    expect(describeError(new Error('Attempt to debit an account but found no record of a prior credit.')).name).toBe('InsufficientFunds');
    const lamports = {
      logs: ['Program 11111111111111111111111111111111 invoke [2]', 'Transfer: insufficient lamports 5000, need 10000000', 'Program 11111111111111111111111111111111 failed: custom program error: 0x1'],
    };
    expect(describeError(lamports).name).toBe('InsufficientFunds');
    expect(describeError(new Error('Signature abc has expired: block height exceeded.')).name).toBe('BlockhashExpired');
    expect(describeError(new Error('Blockhash not found')).name).toBe('BlockhashExpired');
    const inUse = { logs: ['Allocate: account Address { address: X, base: None } already in use', 'Program 1111 failed: custom program error: 0x0'] };
    expect(describeError(inUse)).toMatchObject({ code: 0, name: 'AccountAlreadyInUse' });
    expect(describeError(new TypeError('fetch failed')).name).toBe('NetworkError');
    expect(describeError({ message: 'AnchorError caused by account: session. Error Code: AccountNotInitialized. Error Number: 3012.' }).name).toBe(
      'AccountNotInitialized',
    );
    expect(describeError(new Error('boom\nmore details'))).toEqual({ code: null, name: null, message: 'boom' });
    expect(describeError(undefined).message).toBe('Something went wrong.');
    expect(programErrorCode(null)).toBeNull();
  });

  it('error table matches the IDL', () => {
    const idl = JSON.parse(readFileSync(new URL('../src/idl/slana.json', import.meta.url), 'utf8')) as {
      errors: { code: number; name: string }[];
    };
    expect(idl.errors.map((e) => [e.code, e.name])).toEqual(Object.entries(SlanaErrorCode).map(([name, code]) => [code, name]));
    expect(SlanaErrorCode.SessionMismatch).toBe(6019);
    for (const e of idl.errors) expect(SLANA_ERRORS[e.code].name).toBe(e.name);
  });
});
