import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installProcessGuards } from '../src/process-guards';

describe('process guards', () => {
  it('logs an unhandled rejection (URLs redacted) and keeps running', () => {
    const proc = new EventEmitter();
    const logs: string[] = [];
    const fatal: string[] = [];
    installProcessGuards((m) => logs.push(m), (w) => fatal.push(w), proc as never);
    proc.emit('unhandledRejection', new Error('fetch https://rpc.example/v1/SECRETKEY failed'));
    expect(fatal).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('unhandled promise rejection');
    expect(logs[0]).not.toContain('SECRETKEY');
  });

  it('an uncaught exception is logged and triggers the clean shutdown', () => {
    const proc = new EventEmitter();
    const logs: string[] = [];
    const fatal: string[] = [];
    installProcessGuards((m) => logs.push(m), (w) => fatal.push(w), proc as never);
    proc.emit('uncaughtException', new Error('boom at https://rpc.example/?key=SECRETKEY'));
    expect(fatal).toEqual(['uncaughtException']);
    expect(logs[0]).toContain('uncaught exception');
    expect(logs[0]).not.toContain('SECRETKEY');
  });
});
