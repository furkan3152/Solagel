//! `mint_pass()` — reference `instructions/mint_pass.rs`: free mint of a Slana Pass, a
//! Metaplex Core asset owned by the minter in the Pass collection (`CreateV2` signed by the
//! `pass_authority` PDA and the new asset keypair). Minting the last Pass of the supply ends
//! the mint (no entropy target: `reveal_pass` sets it later).
//!
//! Accounts: 0 minter, 1 asset, 2 config, 3 collection, 4 pass_authority, 5 mint_counter,
//! 6 minter_token (optional; the program id = None), 7 mpl_core_program, 8 system_program.
//!
//! | reference constraint                                                    | lean check                       | error |
//! |-------------------------------------------------------------------------|----------------------------------|-------|
//! | `minter: Signer`, `asset: Signer`                                       | `check_signer`                   | 3010 |
//! | `config: Box<Account<Config>>`                                          | `check_account`                  | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `collection`, `pass_authority`, `mpl_core_program: UncheckedAccount`    | `at`                             | 3005 |
//! | `mint_counter: init_if_needed` (only taken here)                        | `at`                             | 3005 |
//! | `minter_token: Option<Box<InterfaceAccount<TokenAccount>>>`             | `kind::OPT` + `load_token_account` | as `InterfaceAccount` when Some |
//! | `system_program: Program<System>`                                       | `check_program`                  | 3008 / 3009 |
//! | `mint_counter: seeds = [PASS_MINTED_SEED, minter], bump` (canonical)    | `check_canonical_pda`            | 2006 |
//! | `mint_counter: init_if_needed, payer = minter, space = 8 + INIT_SPACE`: system-owned → create (or fund + allocate + assign) | `init_pda` | system program / 4101 |
//! | … else `Account<MintCounter>::try_from`                                 | `check_account`                  | 3007 / 3001 / 3002 / 3003 |
//! | … `if_needed`: `space == data_len`, owner == program, rent-exempt       | same                             | 2019 / 2004 / 2005 |
//! | `mint_counter: mut` (implied by `init`)                                 | `check_writable`                 | 2000 |
//! | duplicate `mut` accounts (config, mint_counter)                         | — (both PDAs of distinct seeds, checked above) | (2040) |
//! | `minter: mut`, `asset: mut`                                             | `check_writable`                 | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`              | `stake::check_config`            | 2006 / 2000 |
//! | `collection: mut`                                                       | `check_writable`                 | 2000 |
//! | `pass_authority: seeds = [PASS_AUTHORITY_SEED], bump` (canonical)       | `check_canonical_pda`            | 2006 |
//! | `mpl_core_program: address = MPL_CORE_ID`                               | key compare                      | 2012 |
//! | `require_keys_neq!(config.pass_collection, default)`                    | same                             | CollectionNotSet |
//! | `require_keys_eq!(collection, config.pass_collection)`                  | same                             | BadCollection |
//! | `require!(pass_seed_hash != [0; 32])`                                   | same                             | SeedNotSet |
//! | `require!(open && now >= start_ts && !ended && !revealed)`              | same                             | MintClosed |
//! | `require!(pass_minted < pass_supply)` (defensive)                       | same                             | MintSoldOut |
//! | `require!(mint_counter.count < pass_per_wallet)`                        | same                             | MintLimit |
//! | `pass_min_tokens > 0`: `minter_token` Some, owner = minter, mint = token_mint, amount ≥ min | same          | MintMinTokens |
//! | `pass_minted.checked_add(1)`                                            | `checked_add`                    | MathOverflow |
//! | `require!(pass_base_uri_len > 0)`                                       | same                             | BadBaseUri |
//! | `invoke_signed(CreateV2, [PASS_AUTHORITY_SEED, bump])`                  | `core_cpi::create_v2`            | Core program |
//! | sold out: `shared::end_pass_mint`                                       | `close_pass_mint::end_pass_mint` | MintEnded |
//! | `mint_counter.count.checked_add(1)`                                     | `checked_add`                    | MathOverflow |
//!
//! Emits `PassMintEnded` (sold out) and `PassMinted`.

use {
    super::{close_pass_mint::end_pass_mint, stake, unix_timestamp},
    crate::error::{Error, Result},
    crate::{
        accounts::{
            check_account, check_canonical_pda, check_kinds, check_writable, data, init_pda,
            is_none, keq, kind, rent_minimum,
        },
        borsh::{rd_arr, rd_bool, rd_i64, rd_key, rd_u32, rd_u64, rd_u8, wr_bytes, wr_u32, wr_u8},
        constants::{
            BASE_URI_BYTES, MPL_CORE_ID, PASS_AUTHORITY_SEED, PASS_MINTED_SEED, SYSTEM_PROGRAM_ID,
        },
        core_cpi::create_v2,
        error::{
            err, require, ACCOUNT_NOT_ENOUGH_KEYS, BAD_BASE_URI, BAD_COLLECTION,
            COLLECTION_NOT_SET, CONSTRAINT_ADDRESS, CONSTRAINT_OWNER, CONSTRAINT_RENT_EXEMPT,
            CONSTRAINT_SPACE, MATH_OVERFLOW, MINT_CLOSED, MINT_LIMIT, MINT_MIN_TOKENS,
            MINT_SOLD_OUT, SEED_NOT_SET,
        },
        events,
        state::{config, mint_counter},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN, ACCOUNT_MINT, ACCOUNT_OWNER},
        ID,
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView,
    },
};

const KINDS: [u8; 9] = [
    kind::SIGNER,
    kind::SIGNER,
    kind::CONFIG,
    kind::ANY,
    kind::ANY,
    kind::ANY,
    kind::TOKEN_ACCOUNT | kind::OPT,
    kind::ANY,
    kind::SYSTEM_PROGRAM,
];

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    // ----- account types, in declaration order -------------------------------------------
    check_kinds(accounts, &KINDS)?;
    let Some(
        [minter, asset, config_acc, collection, pass_authority, counter, minter_token, core_program, system_program],
    ) = accounts.first_chunk::<9>()
    else {
        return Err(err(ACCOUNT_NOT_ENOUGH_KEYS));
    };

    // ----- init_if_needed: mint_counter ----------------------------------------------------
    let counter_bump = check_canonical_pda(
        counter,
        &[
            Seed::from(PASS_MINTED_SEED),
            Seed::from(minter.address().as_ref()),
        ],
        &ID,
    )?;
    if counter.owned_by(&SYSTEM_PROGRAM_ID) {
        let bump = [counter_bump];
        init_pda(
            minter,
            counter,
            mint_counter::SPACE,
            &ID,
            &[
                Seed::from(PASS_MINTED_SEED),
                Seed::from(minter.address().as_ref()),
                Seed::from(&bump),
            ],
        )?;
    } else {
        check_account(counter, &mint_counter::DISCRIMINATOR, mint_counter::SPACE)?;
    }
    require(counter.data_len() == mint_counter::SPACE, CONSTRAINT_SPACE)?;
    require(counter.owned_by(&ID), CONSTRAINT_OWNER)?;
    require(
        counter.lamports() >= rent_minimum(mint_counter::SPACE)?,
        CONSTRAINT_RENT_EXEMPT,
    )?;
    check_writable(counter)?;

    // ----- the remaining constraints -------------------------------------------------------
    // SAFETY: `check_kinds` checked the config; the counter is its own PDA (checked above,
    // `data_len == SPACE`), so the two views are of distinct accounts.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let m = unsafe { data::<{ mint_counter::SPACE }>(counter) };
    check_writable(minter)?;
    check_writable(asset)?;
    stake::check_config(config_acc, c, true)?;
    check_writable(collection)?;
    let authority_bump =
        check_canonical_pda(pass_authority, &[Seed::from(PASS_AUTHORITY_SEED)], &ID)?;
    require(
        keq(core_program.address().as_array(), MPL_CORE_ID.as_array()),
        CONSTRAINT_ADDRESS,
    )?;

    // ----- handler ---------------------------------------------------------------------------
    // 1. Collection set (and this is it).
    let pass_collection = rd_key(c, config::PASS_COLLECTION);
    require(!keq(&pass_collection, &[0; 32]), COLLECTION_NOT_SET)?;
    require(
        keq(collection.address().as_array(), &pass_collection),
        BAD_COLLECTION,
    )?;
    // 2. Trait seed committed.
    require(
        !keq(&rd_key(c, config::PASS_SEED_HASH), &[0; 32]),
        SEED_NOT_SET,
    )?;
    // 3. Mint open (never again once it ended or the seed is revealed).
    let now = unix_timestamp()?;
    require(
        rd_bool(c, config::PASS_MINT_OPEN)
            && now >= rd_i64(c, config::PASS_MINT_START_TS)
            && !rd_bool(c, config::PASS_MINT_ENDED)
            && !rd_bool(c, config::PASS_REVEALED),
        MINT_CLOSED,
    )?;
    // 4. Supply left (defensive: selling out ends the mint, so `MintClosed` fires first).
    let minted = rd_u32(c, config::PASS_MINTED);
    let supply = rd_u32(c, config::PASS_SUPPLY);
    require(minted < supply, MINT_SOLD_OUT)?;
    // 5. Per-wallet limit.
    let count = rd_u8(m, mint_counter::COUNT);
    require(count < rd_u8(c, config::PASS_PER_WALLET), MINT_LIMIT)?;
    // 6. Minimum game-token balance (checked, never taken).
    let min_tokens = rd_u64(c, config::PASS_MIN_TOKENS);
    if min_tokens > 0 {
        let holds_enough = !is_none(minter_token) && {
            // SAFETY: `check_kinds` checked it is a token account (≥ 165 bytes); read only.
            let t = unsafe { data::<ACCOUNT_LEN>(minter_token) };
            keq(&rd_key(t, ACCOUNT_OWNER), minter.address().as_array())
                && keq(&rd_key(t, ACCOUNT_MINT), &rd_key(c, config::TOKEN_MINT))
                && rd_u64(t, ACCOUNT_AMOUNT) >= min_tokens
        };
        require(holds_enough, MINT_MIN_TOKENS)?;
    }

    let number = minted.checked_add(1).ok_or_else(|| err(MATH_OVERFLOW))?;
    let uri_len = rd_u8(c, config::PASS_BASE_URI_LEN);
    require(uri_len > 0, BAD_BASE_URI)?;
    let uri = rd_arr::<BASE_URI_BYTES>(c, config::PASS_BASE_URI);
    // `update_config` keeps the length ≤ 96; the reference would panic on a longer one.
    let base_uri = uri
        .get(..usize::from(uri_len))
        .ok_or(Error::INVALID_ACCOUNT_DATA)?;

    let bump = [authority_bump];
    let seeds = [Seed::from(PASS_AUTHORITY_SEED), Seed::from(&bump)];
    create_v2(
        asset,
        collection,
        pass_authority,
        minter,
        core_program,
        system_program,
        number,
        base_uri,
        &[Signer::from(&seeds)],
    );

    wr_u32(c, config::PASS_MINTED, number);
    if number >= supply {
        // Sold out: the mint ends here.
        end_pass_mint(c)?;
    }
    let count = count.checked_add(1).ok_or_else(|| err(MATH_OVERFLOW))?;
    wr_bytes(m, 0, &mint_counter::DISCRIMINATOR);
    wr_u8(m, mint_counter::COUNT, count);
    wr_u8(m, mint_counter::BUMP, counter_bump);

    events::emit(&events::pass_minted(
        minter.address().as_array(),
        asset.address().as_array(),
        number,
    ));
    Ok(())
}
