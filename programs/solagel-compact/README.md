# Compact Solagel program

This is the deployable implementation of the existing SOL beta ABI. The Anchor program in `../solagel` remains the reference and IDL source. Both implement the same 17 instructions, PDA seeds, account layouts, application error codes and event payloads. No game or money feature is removed to reduce rent.

`build.rs` reads the reference `declare_id!`, so both implementations share the program address. The deployable artifact is `target/deploy/solagel_compact.so`; deploy it with the reference program's matching keypair, not the incidental compact build keypair. The SDK IDL still comes from the reference program.

## Build and verify

Run from the repository root:

```bash
corepack pnpm program:test
corepack pnpm -F @solagel/sdk deploy-budget
```

`program:test` builds both SBF programs, checks compact host arithmetic/System Program encodings, runs the existing transaction suite against the compact artifact and compares the two executables in deterministic LiteSVM fixtures. The comparison checks success/failure, account bytes, lamports and event payloads after every transaction, including rollback. Two explicitly tested extreme failures improve the reference: impossible name lengths return error 102 instead of heap exhaustion, and advancing season `u32::MAX` returns 6022 instead of a panic. Both roll back all state. Individual compact transaction tests can be selected with `SOLAGEL_TEST_PROGRAM=/absolute/path/to/solagel_compact.so cargo test -p solagel`; `SOLAGEL_PARITY_PROGRAM` can override the compact binary for the ignored parity suite.

`scripts/build-program.sh` uses the pinned Agave SBF toolchain, size optimization, reduced LLVM inlining, LTO and panic abort. It rejects compiler stack overflow diagnostics even when the compiler returns success. A static panic diagnostic still aborts and rolls back transactions.

The budget command only reads the artifact and RPC rent requirements. It includes program accounts, initial Config/season/three arenas and a 0.02 SOL allowance for fees/initial server operation; hosting and optional prize funding are separate. It fails if the live estimate exceeds 0.5 SOL. Rerun it after every build and before signing a deployment.

## Maintenance contract

Change both implementations when changing semantics or ABI. Regenerate the reference IDL, run the entire differential suite and a signed localnet flow, and recalculate deployment rent. Compact account guards are explicit: owner/discriminator, writable/signature, PDA seeds and bumps, upgrade authority, rent reserve and checked money arithmetic must remain enforced. Existing prefunded empty PDAs, allowed destination aliases and trailing account/instruction bytes retain their reference behavior.

Token escrow and NFT ownership are separate future integrations. The compact program preserves the SOL beta behavior and does not pretend that reserving asset metadata enables those features. An independent security audit is still needed before production use.
