/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/slana.json`.
 */
export type Slana = {
  "address": "5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472",
  "metadata": {
    "name": "slana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Slana: cute coin-themed on-chain Agar.io (identity, stakes, seasons, prizes)"
  },
  "instructions": [
    {
      "name": "capturePassEntropy",
      "docs": [
        "Permissionless: once the seed is public and the target slot has passed, stores the",
        "entropy (hash of the first slot at or after the target) and the final seed, which",
        "reveals the traits; re-targets if the target left the SlotHashes window."
      ],
      "discriminator": [
        187,
        128,
        145,
        219,
        72,
        180,
        205,
        195
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Anyone; only pays the transaction fee."
          ],
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimSeasonReward",
      "discriminator": [
        129,
        96,
        145,
        129,
        154,
        203,
        29,
        150
      ],
      "accounts": [
        {
          "name": "claimer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonId"
              }
            ]
          }
        },
        {
          "name": "seasonVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "claimerToken",
          "docs": [
            "Receives the prize: a game-token account of the claimer."
          ],
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "seasonId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "closePassMint",
      "docs": [
        "Ends the Pass mint for good (no entropy target yet: `reveal_pass` sets it)."
      ],
      "discriminator": [
        227,
        254,
        103,
        66,
        121,
        84,
        65,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createArena",
      "discriminator": [
        174,
        236,
        45,
        61,
        197,
        215,
        149,
        169
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "The arena's token vault: holds every entry fee, signed for by the arena PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u16"
        },
        {
          "name": "entryFee",
          "type": "u64"
        },
        {
          "name": "maxSessions",
          "type": "u16"
        },
        {
          "name": "requiresPass",
          "type": "bool"
        }
      ]
    },
    {
      "name": "endSeason",
      "discriminator": [
        167,
        166,
        166,
        109,
        166,
        71,
        15,
        68
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "nextSeason",
          "docs": [
            "Season `config.current_season + 1`."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the config, the treasury and season vaults and season 1 for the game mint.",
        "Only the program's upgrade authority may call it."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must be the program's upgrade authority (prevents front-running `initialize`)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "const",
                "value": [
                  1,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "The game token. Validated by `token::validate_mint` (no freeze authority, no",
            "forbidden Token-2022 extension) and stored in the config for good."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "treasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "seasonVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472"
        },
        {
          "name": "programData",
          "docs": [
            "The program's ProgramData account (PDA of the upgradeable loader, seeds `[program_id]`)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  72,
                  111,
                  38,
                  149,
                  160,
                  93,
                  0,
                  23,
                  177,
                  15,
                  48,
                  252,
                  98,
                  121,
                  13,
                  150,
                  85,
                  64,
                  195,
                  168,
                  89,
                  155,
                  185,
                  173,
                  103,
                  216,
                  69,
                  152,
                  128,
                  182,
                  245,
                  57
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                2,
                168,
                246,
                145,
                78,
                136,
                161,
                176,
                226,
                16,
                21,
                62,
                247,
                99,
                174,
                43,
                0,
                194,
                185,
                61,
                22,
                193,
                36,
                210,
                192,
                83,
                122,
                16,
                4,
                128,
                0,
                0
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeArgs"
            }
          }
        }
      ]
    },
    {
      "name": "joinArena",
      "docs": [
        "Pays the entry fee into the arena vault and opens a session (no Pass). Fails with",
        "`FeeAboveLimit` if the fee rate fixed into the session exceeds `max_fee_bps` (the rate",
        "the player was shown), the arena's entry fee exceeds `max_entry_fee`",
        "(`EntryFeeAboveLimit`) or the settle deposit exceeds `max_settle_fee`",
        "(`SettleFeeAboveLimit`)."
      ],
      "discriminator": [
        135,
        217,
        203,
        200,
        93,
        181,
        131,
        47
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "session",
          "docs": [
            "One open session per player per arena: a second join fails because the PDA exists",
            "(also while a finalized session waits for its payout to be collected)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxFeeBps",
          "type": "u16"
        },
        {
          "name": "maxEntryFee",
          "type": "u64"
        },
        {
          "name": "maxSettleFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "joinArenaWithPass",
      "docs": [
        "Like `join_arena`, backed by a Slana Pass that is locked until the session closes."
      ],
      "discriminator": [
        145,
        196,
        60,
        74,
        142,
        112,
        166,
        224
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "passAsset",
          "docs": [
            "(owned by the Core program, owned by `player`, in `config.pass_collection`)."
          ]
        },
        {
          "name": "passLock",
          "docs": [
            "Exists while the Pass backs an open session: a second join with the same Pass fails",
            "with the System Program's \"already in use\" error (`PassInUse` in the SDK)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "passAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxFeeBps",
          "type": "u16"
        },
        {
          "name": "maxEntryFee",
          "type": "u64"
        },
        {
          "name": "maxSettleFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintPass",
      "docs": [
        "Free mint of one Slana Pass (Core asset in the Pass collection) to the signer."
      ],
      "discriminator": [
        142,
        56,
        26,
        197,
        227,
        241,
        84,
        174
      ],
      "accounts": [
        {
          "name": "minter",
          "writable": true,
          "signer": true
        },
        {
          "name": "asset",
          "docs": [
            "The new Core asset (a fresh keypair)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "`CollectionNotSet`); Core validates its contents during the CPI."
          ],
          "writable": true
        },
        {
          "name": "passAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mintCounter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "minter"
              }
            ]
          }
        },
        {
          "name": "minterToken",
          "docs": [
            "Game-token account of the minter; only needed when `config.pass_min_tokens > 0`."
          ],
          "optional": true
        },
        {
          "name": "mplCoreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refundSession",
      "docs": [
        "Player-signed. A finalized session pays its `owed` payout at once; an unsettled one",
        "returns the entry fee after `SESSION_REFUND_TIMEOUT_SECS`."
      ],
      "discriminator": [
        168,
        87,
        185,
        45,
        250,
        170,
        10,
        85
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          },
          "relations": [
            "session"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "passLock",
          "docs": [
            "Required iff the session has a Pass and is not finalized (settlement already closed the",
            "lock of a finalized session): its lock, closed back to the player."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "registerPlayer",
      "discriminator": [
        242,
        146,
        194,
        234,
        234,
        145,
        228,
        42
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "skin",
          "type": "u8"
        }
      ]
    },
    {
      "name": "revealPass",
      "docs": [
        "Publishes the Pass trait seed (checked against the committed hash), once, after the",
        "mint ended, then sets the entropy target slot."
      ],
      "discriminator": [
        233,
        27,
        93,
        192,
        147,
        157,
        246,
        103
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "rolloverSeason",
      "discriminator": [
        100,
        231,
        139,
        192,
        118,
        134,
        116,
        197
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oldSeason",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonId"
              }
            ]
          }
        },
        {
          "name": "currentSeason",
          "docs": [
            "`dup` so that `season_id == current_season` is reported as `InvalidSeason` by the",
            "constraint above instead of a generic duplicate-account error."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "seasonId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setPassCollection",
      "docs": [
        "Sets the Pass collection once (a Core collection whose update authority is the",
        "`pass_authority` PDA)."
      ],
      "discriminator": [
        60,
        188,
        194,
        201,
        72,
        107,
        78,
        208
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collection"
        },
        {
          "name": "passAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setPassSeedHash",
      "docs": [
        "Commits `sha256(seed)` of the Pass trait seed (before the first mint)."
      ],
      "discriminator": [
        192,
        248,
        24,
        81,
        247,
        241,
        216,
        11
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "settleSession",
      "docs": [
        "Server-signed cash-out of a stake session. With the player's token account the payout",
        "is paid and the session closed; without it (`player_token = None`) the session is",
        "finalized with `owed` for the player to collect via `refund_session` (ruling R24)."
      ],
      "discriminator": [
        156,
        20,
        180,
        117,
        117,
        85,
        225,
        128
      ],
      "accounts": [
        {
          "name": "server",
          "docs": [
            "Receives the session's settle deposit."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          },
          "relations": [
            "session"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "session",
          "docs": [
            "Closed back to the player when the payout is paid in this transaction; kept open",
            "(finalized, with `owed`) when `player_token` is absent."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "player",
          "docs": [
            "Pass lock rent)."
          ],
          "writable": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "playerToken",
          "docs": [
            "Any token account of the game mint owned by the player (the player creates and pays",
            "for it; the server never does). Optional (R24): without it, or when the player",
            "made it unable to receive, the server settles anyway and the session is finalized with",
            "`owed`, which the player collects with `refund_session`. So a player can delay their",
            "own payout but never block the game result."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "seasonVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Writable: the burn share lowers its supply."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "passLock",
          "docs": [
            "Required iff the session has a Pass: its lock, closed back to the player."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "settleArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sweepArena",
      "discriminator": [
        124,
        38,
        247,
        190,
        34,
        58,
        64,
        7
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "seasonVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "sweepLoot",
      "docs": [
        "Server-signed: moves `amount` (at most the vault balance) from an arena vault into the",
        "current season's pool, while the arena runs. `amount == 0` succeeds and does nothing."
      ],
      "discriminator": [
        221,
        67,
        119,
        145,
        176,
        100,
        54,
        6
      ],
      "accounts": [
        {
          "name": "server",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "seasonVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateArena",
      "discriminator": [
        179,
        14,
        84,
        80,
        59,
        23,
        182,
        226
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": {
            "option": "bool"
          }
        },
        {
          "name": "maxSessions",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "entryFee",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "requiresPass",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "updateProfile",
      "discriminator": [
        98,
        67,
        99,
        206,
        86,
        115,
        175,
        1
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "profile"
          ]
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "skin",
          "type": {
            "option": "u8"
          }
        }
      ]
    },
    {
      "name": "withdrawTreasury",
      "discriminator": [
        40,
        63,
        122,
        158,
        144,
        216,
        83,
        96
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "arena",
      "discriminator": [
        243,
        215,
        44,
        44,
        231,
        211,
        232,
        168
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "mintCounter",
      "discriminator": [
        29,
        59,
        15,
        69,
        46,
        22,
        227,
        173
      ]
    },
    {
      "name": "passLock",
      "discriminator": [
        111,
        167,
        37,
        191,
        114,
        227,
        253,
        159
      ]
    },
    {
      "name": "playerProfile",
      "discriminator": [
        82,
        226,
        99,
        87,
        164,
        130,
        181,
        80
      ]
    },
    {
      "name": "season",
      "discriminator": [
        76,
        67,
        93,
        156,
        180,
        157,
        248,
        47
      ]
    },
    {
      "name": "session",
      "discriminator": [
        243,
        81,
        72,
        115,
        214,
        188,
        72,
        144
      ]
    }
  ],
  "events": [
    {
      "name": "arenaCreated",
      "discriminator": [
        93,
        57,
        84,
        96,
        112,
        3,
        148,
        17
      ]
    },
    {
      "name": "arenaJoined",
      "discriminator": [
        195,
        38,
        154,
        241,
        247,
        142,
        31,
        5
      ]
    },
    {
      "name": "arenaSwept",
      "discriminator": [
        132,
        32,
        57,
        60,
        149,
        87,
        201,
        80
      ]
    },
    {
      "name": "lootSwept",
      "discriminator": [
        81,
        202,
        37,
        221,
        228,
        204,
        163,
        220
      ]
    },
    {
      "name": "passCollectionSet",
      "discriminator": [
        159,
        63,
        91,
        220,
        66,
        126,
        121,
        171
      ]
    },
    {
      "name": "passEntropyCaptured",
      "discriminator": [
        190,
        90,
        135,
        238,
        49,
        72,
        218,
        122
      ]
    },
    {
      "name": "passEntropyRetargeted",
      "discriminator": [
        247,
        163,
        240,
        184,
        80,
        73,
        235,
        214
      ]
    },
    {
      "name": "passMintEnded",
      "discriminator": [
        62,
        149,
        116,
        122,
        113,
        242,
        93,
        181
      ]
    },
    {
      "name": "passMinted",
      "discriminator": [
        41,
        18,
        56,
        61,
        177,
        162,
        4,
        13
      ]
    },
    {
      "name": "passRevealed",
      "discriminator": [
        31,
        81,
        11,
        22,
        7,
        225,
        19,
        53
      ]
    },
    {
      "name": "passSeedRevealed",
      "discriminator": [
        42,
        110,
        80,
        48,
        148,
        5,
        106,
        38
      ]
    },
    {
      "name": "playerRegistered",
      "discriminator": [
        175,
        78,
        252,
        170,
        75,
        230,
        36,
        251
      ]
    },
    {
      "name": "profileUpdated",
      "discriminator": [
        186,
        248,
        62,
        98,
        112,
        98,
        161,
        252
      ]
    },
    {
      "name": "rewardClaimed",
      "discriminator": [
        49,
        28,
        87,
        84,
        158,
        48,
        229,
        175
      ]
    },
    {
      "name": "seasonEnded",
      "discriminator": [
        231,
        210,
        35,
        6,
        231,
        92,
        111,
        69
      ]
    },
    {
      "name": "seasonRolledOver",
      "discriminator": [
        70,
        173,
        38,
        206,
        53,
        30,
        122,
        83
      ]
    },
    {
      "name": "sessionRefunded",
      "discriminator": [
        176,
        138,
        119,
        46,
        99,
        172,
        75,
        152
      ]
    },
    {
      "name": "sessionSettled",
      "discriminator": [
        127,
        161,
        59,
        136,
        23,
        168,
        191,
        149
      ]
    },
    {
      "name": "treasuryWithdrawn",
      "discriminator": [
        143,
        181,
        157,
        169,
        87,
        155,
        170,
        46
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6002,
      "name": "invalidFee",
      "msg": "Invalid fee configuration"
    },
    {
      "code": 6003,
      "name": "invalidName",
      "msg": "Name must be 1-16 bytes of UTF-8 without control characters"
    },
    {
      "code": 6004,
      "name": "invalidSkin",
      "msg": "Invalid skin id"
    },
    {
      "code": 6005,
      "name": "arenaDisabled",
      "msg": "Arena is disabled"
    },
    {
      "code": 6006,
      "name": "arenaFull",
      "msg": "Arena is full"
    },
    {
      "code": 6007,
      "name": "insufficientPot",
      "msg": "Amount exceeds the available pot"
    },
    {
      "code": 6008,
      "name": "refundTooEarly",
      "msg": "Session cannot be refunded yet"
    },
    {
      "code": 6009,
      "name": "seasonFinalized",
      "msg": "Season is already finalized"
    },
    {
      "code": 6010,
      "name": "seasonNotFinalized",
      "msg": "Season is not finalized"
    },
    {
      "code": 6011,
      "name": "notEligible",
      "msg": "Not eligible for a season reward"
    },
    {
      "code": 6012,
      "name": "alreadyClaimed",
      "msg": "Reward already claimed"
    },
    {
      "code": 6013,
      "name": "claimWindowClosed",
      "msg": "Claim window is closed"
    },
    {
      "code": 6014,
      "name": "claimWindowOpen",
      "msg": "Claim window is still open"
    },
    {
      "code": 6015,
      "name": "invalidSeason",
      "msg": "Invalid season"
    },
    {
      "code": 6016,
      "name": "arenaHasOpenSessions",
      "msg": "Arena still has open sessions"
    },
    {
      "code": 6017,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6018,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6019,
      "name": "sessionMismatch",
      "msg": "Settlement is for a different session"
    },
    {
      "code": 6020,
      "name": "mintNotAllowed",
      "msg": "Token mint is not allowed (wrong program or forbidden Token-2022 extension)"
    },
    {
      "code": 6021,
      "name": "freezeAuthorityPresent",
      "msg": "Token mint must not have a freeze authority"
    },
    {
      "code": 6022,
      "name": "passRequired",
      "msg": "This arena requires a Slana Pass"
    },
    {
      "code": 6023,
      "name": "passNotOwned",
      "msg": "Slana Pass is not owned by the player"
    },
    {
      "code": 6024,
      "name": "passWrongCollection",
      "msg": "Asset is not part of the Slana Pass collection"
    },
    {
      "code": 6025,
      "name": "passInUse",
      "msg": "Slana Pass is already used by an open session"
    },
    {
      "code": 6026,
      "name": "mintClosed",
      "msg": "Pass mint is closed"
    },
    {
      "code": 6027,
      "name": "mintSoldOut",
      "msg": "Pass mint is sold out"
    },
    {
      "code": 6028,
      "name": "mintLimit",
      "msg": "Pass mint limit per wallet reached"
    },
    {
      "code": 6029,
      "name": "mintMinTokens",
      "msg": "Not enough tokens to mint a Pass"
    },
    {
      "code": 6030,
      "name": "seedMismatch",
      "msg": "Seed does not match the committed hash"
    },
    {
      "code": 6031,
      "name": "seedNotSet",
      "msg": "Pass seed hash is not set"
    },
    {
      "code": 6032,
      "name": "alreadyRevealed",
      "msg": "Pass traits are already revealed"
    },
    {
      "code": 6033,
      "name": "collectionAlreadySet",
      "msg": "Pass collection is already set"
    },
    {
      "code": 6034,
      "name": "collectionNotSet",
      "msg": "Pass collection is not set"
    },
    {
      "code": 6035,
      "name": "badCollection",
      "msg": "Invalid Pass collection"
    },
    {
      "code": 6036,
      "name": "badSplit",
      "msg": "Fee split must sum to 10000 basis points"
    },
    {
      "code": 6037,
      "name": "arenaBusy",
      "msg": "Arena has open sessions"
    },
    {
      "code": 6038,
      "name": "badBaseUri",
      "msg": "Invalid Pass base URI"
    },
    {
      "code": 6039,
      "name": "invalidMaxSessions",
      "msg": "Max sessions must be between 2 and 2000"
    },
    {
      "code": 6040,
      "name": "entryFeeZero",
      "msg": "Entry fee must be greater than zero"
    },
    {
      "code": 6041,
      "name": "seedLocked",
      "msg": "Pass seed hash can only change before the first mint"
    },
    {
      "code": 6042,
      "name": "mintStillOpen",
      "msg": "Pass mint is still open"
    },
    {
      "code": 6043,
      "name": "mintEnded",
      "msg": "Pass mint has ended for good; it cannot reopen"
    },
    {
      "code": 6044,
      "name": "supplyLocked",
      "msg": "Pass supply cannot change once the mint has opened"
    },
    {
      "code": 6045,
      "name": "useCloseMint",
      "msg": "A Pass mint with minted Passes is closed with close_pass_mint"
    },
    {
      "code": 6046,
      "name": "badSlotHashes",
      "msg": "Invalid SlotHashes sysvar account"
    },
    {
      "code": 6047,
      "name": "nothingMinted",
      "msg": "No Pass has been minted yet"
    },
    {
      "code": 6048,
      "name": "entropyNotReady",
      "msg": "The Pass entropy target slot has not passed yet"
    },
    {
      "code": 6049,
      "name": "entropyNotCaptured",
      "msg": "The Pass entropy is not captured yet"
    },
    {
      "code": 6050,
      "name": "seedNotRevealed",
      "msg": "The Pass seed is not revealed yet"
    },
    {
      "code": 6051,
      "name": "feeAboveLimit",
      "msg": "The fee rate is above the limit the player signed"
    },
    {
      "code": 6052,
      "name": "entryFeeAboveLimit",
      "msg": "The entry fee is above the limit the player signed"
    },
    {
      "code": 6053,
      "name": "settleFeeAboveLimit",
      "msg": "The settle deposit is above the limit the player signed"
    },
    {
      "code": 6054,
      "name": "sessionFinalized",
      "msg": "Session is already settled; the player collects the payout with refund_session"
    },
    {
      "code": 6055,
      "name": "invalidAuthority",
      "msg": "Authority must not be the default public key"
    }
  ],
  "types": [
    {
      "name": "arena",
      "docs": [
        "A stake arena tier. PDA `[\"arena\", id.to_le_bytes()]`.",
        "",
        "Entry fees are held in the arena's token vault `[\"vault\", arena]` (authority = this PDA)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "entryFee",
            "docs": [
              "Entry fee in base units of the game token."
            ],
            "type": "u64"
          },
          {
            "name": "requiresPass",
            "docs": [
              "Only Slana Pass holders may join."
            ],
            "type": "bool"
          },
          {
            "name": "maxSessions",
            "docs": [
              "Maximum number of simultaneously open sessions."
            ],
            "type": "u16"
          },
          {
            "name": "openSessions",
            "type": "u16"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "vault",
            "docs": [
              "The arena's token vault."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalPaidOut",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "arenaCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "maxSessions",
            "type": "u16"
          },
          {
            "name": "requiresPass",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "arenaJoined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "sessionId",
            "type": "u64"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "hasPass",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "arenaSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global configuration. PDA `[\"config\"]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "May change the configuration, create arenas, manage seasons and withdraw the treasury."
            ],
            "type": "pubkey"
          },
          {
            "name": "serverAuthority",
            "docs": [
              "Game server key that signs `settle_session`."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "The game token ($SLANA). Written once and never changed."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Token program owning `token_mint` (SPL Token or Token-2022)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenDecimals",
            "type": "u8"
          },
          {
            "name": "feeBps",
            "docs": [
              "Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`)."
            ],
            "type": "u16"
          },
          {
            "name": "passFeeBps",
            "docs": [
              "Fee charged on stake profit of a Pass session (≤ `fee_bps`)."
            ],
            "type": "u16"
          },
          {
            "name": "treasuryBps",
            "docs": [
              "Shares of each fee: treasury vault, season vault, burned. They sum to `BPS`."
            ],
            "type": "u16"
          },
          {
            "name": "seasonBps",
            "type": "u16"
          },
          {
            "name": "burnBps",
            "type": "u16"
          },
          {
            "name": "settleFeeLamports",
            "docs": [
              "Lamports a player deposits per session to pay the server's settle transaction",
              "(≤ `MAX_SETTLE_FEE_LAMPORTS`)."
            ],
            "type": "u64"
          },
          {
            "name": "currentSeason",
            "docs": [
              "Id of the season that is currently running."
            ],
            "type": "u32"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new arena joins (settlements and refunds keep working)."
            ],
            "type": "bool"
          },
          {
            "name": "passCollection",
            "docs": [
              "Metaplex Core collection of the Pass (`Pubkey::default()` = not set yet)."
            ],
            "type": "pubkey"
          },
          {
            "name": "passBaseUri",
            "docs": [
              "Base URI of Pass metadata (`pass_base_uri[..pass_base_uri_len]`, zero padded)."
            ],
            "type": {
              "array": [
                "u8",
                96
              ]
            }
          },
          {
            "name": "passBaseUriLen",
            "type": "u8"
          },
          {
            "name": "passSupply",
            "docs": [
              "Maximum number of Passes (≤ `MAX_PASS_SUPPLY`, ≥ `pass_minted`)."
            ],
            "type": "u32"
          },
          {
            "name": "passMinted",
            "docs": [
              "Passes minted so far."
            ],
            "type": "u32"
          },
          {
            "name": "passPerWallet",
            "docs": [
              "Free mints per wallet (≤ `MAX_PASS_PER_WALLET`)."
            ],
            "type": "u8"
          },
          {
            "name": "passMinTokens",
            "docs": [
              "Minimum game-token balance needed to mint (0 = no requirement)."
            ],
            "type": "u64"
          },
          {
            "name": "passMintOpen",
            "type": "bool"
          },
          {
            "name": "passMintStartTs",
            "type": "i64"
          },
          {
            "name": "passMintOpened",
            "docs": [
              "The mint has been opened at least once: `pass_supply` is frozen from then on."
            ],
            "type": "bool"
          },
          {
            "name": "passMintEnded",
            "docs": [
              "The mint ended for good (`close_pass_mint`, or the last Pass of the supply was minted).",
              "It never reopens; `reveal_pass` may publish the seed from then on."
            ],
            "type": "bool"
          },
          {
            "name": "passSeedHash",
            "docs": [
              "`sha256(pass_seed)` committed before the first mint."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passSeed",
            "docs": [
              "The admin's seed, public once `pass_seed_revealed` (zero before)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passRevealed",
            "docs": [
              "The traits are public: `capture_pass_entropy` stored `pass_final_seed`."
            ],
            "type": "bool"
          },
          {
            "name": "passSeedRevealed",
            "docs": [
              "`reveal_pass` published `pass_seed` (checked against `pass_seed_hash`) and set the",
              "entropy target slot. The seed is public before any entropy target exists."
            ],
            "type": "bool"
          },
          {
            "name": "passEntropyTargetSlot",
            "docs": [
              "Set by `reveal_pass` (after the seed is public): `slot + ENTROPY_DELAY_SLOTS`, moved",
              "forward again if nobody captured it while it was in the SlotHashes window. 0 before."
            ],
            "type": "u64"
          },
          {
            "name": "passEntropyCaptured",
            "docs": [
              "`pass_entropy` holds the captured hash."
            ],
            "type": "bool"
          },
          {
            "name": "passEntropy",
            "docs": [
              "Hash of the first slot at or after the target slot, stored by the permissionless",
              "`capture_pass_entropy` (zero before): a chain value nobody, the admin included, can",
              "know or choose when the mint ends."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passEntropySlot",
            "docs": [
              "Slot of `pass_entropy`."
            ],
            "type": "u64"
          },
          {
            "name": "passFinalSeed",
            "docs": [
              "`sha256(pass_seed || pass_entropy)`, set by `capture_pass_entropy` (zero before). The",
              "single seed every Pass trait is derived from (`passTraits(final_seed, n, supply)`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "treasuryVaultBump",
            "type": "u8"
          },
          {
            "name": "seasonVaultBump",
            "type": "u8"
          },
          {
            "name": "totalPlayers",
            "type": "u64"
          },
          {
            "name": "totalGames",
            "type": "u64"
          },
          {
            "name": "totalSessions",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "totalPaidOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initializeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "serverAuthority",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "passFeeBps",
            "type": "u16"
          },
          {
            "name": "treasuryBps",
            "type": "u16"
          },
          {
            "name": "seasonBps",
            "type": "u16"
          },
          {
            "name": "burnBps",
            "type": "u16"
          },
          {
            "name": "settleFeeLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "leaderEntry",
      "docs": [
        "One row of a season leaderboard."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "points",
            "type": "u64"
          },
          {
            "name": "bestScore",
            "docs": [
              "Best single-game score of this player during the season."
            ],
            "type": "u32"
          },
          {
            "name": "name",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "nameLen",
            "type": "u8"
          },
          {
            "name": "skin",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lootSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "mintCounter",
      "docs": [
        "Number of Passes a wallet minted. PDA `[\"pass_minted\", minter]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "passCollectionSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collection",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "passEntropyCaptured",
      "docs": [
        "`capture_pass_entropy` stored the trait entropy."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "slot",
            "docs": [
              "Slot whose hash is the entropy (the first slot with a block at or after the target)."
            ],
            "type": "u64"
          },
          {
            "name": "entropy",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "passEntropyRetargeted",
      "docs": [
        "The target slot left the SlotHashes window before anyone captured it: a new future target."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "missedTargetSlot",
            "type": "u64"
          },
          {
            "name": "entropyTargetSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "passLock",
      "docs": [
        "Lock of a Pass asset while it backs an open session, so one Pass backs at most one",
        "session at a time (even across transfers). PDA `[\"pass_lock\", asset]`.",
        "Paid by the player at join and closed back to them at settlement or refund."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "passMintEnded",
      "docs": [
        "The Pass mint ended for good (closed by the admin or sold out). Next: `reveal_pass`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minted",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "passMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minter",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "number",
            "docs": [
              "1-based Pass number (`Slana Pass #<number>`)."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "passRevealed",
      "docs": [
        "`capture_pass_entropy` stored the entropy and the final seed: the traits are public."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seed",
            "docs": [
              "The admin's committed seed (`sha256(seed) == pass_seed_hash`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "entropy",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "finalSeed",
            "docs": [
              "`sha256(seed || entropy)`: the seed every Pass trait is derived from."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "passSeedRevealed",
      "docs": [
        "`reveal_pass` published the seed and set the entropy target slot."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "entropyTargetSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "playerProfile",
      "docs": [
        "On-chain player identity and statistics. PDA `[\"profile\", owner]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "docs": [
              "UTF-8 name bytes, zero padded; only `name[..name_len]` is meaningful."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "nameLen",
            "type": "u8"
          },
          {
            "name": "skin",
            "docs": [
              "Equipped skin id (`< BASIC_SKINS`)."
            ],
            "type": "u8"
          },
          {
            "name": "xp",
            "type": "u64"
          },
          {
            "name": "gamesPlayed",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u32"
          },
          {
            "name": "bestScore",
            "type": "u32"
          },
          {
            "name": "totalScore",
            "type": "u64"
          },
          {
            "name": "season",
            "docs": [
              "Season that `season_points` belongs to."
            ],
            "type": "u32"
          },
          {
            "name": "seasonPoints",
            "type": "u64"
          },
          {
            "name": "stakeGames",
            "type": "u32"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "totalWon",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "lastPlayed",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "profileUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "skin",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "rank",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "season",
      "docs": [
        "A season with its top-20 leaderboard. PDA `[\"season\", id.to_le_bytes()]`.",
        "",
        "Prize tokens live in the global season vault (`[\"season_vault\"]`); `pool` is this",
        "season's share of it. While the season runs, settle fee shares, sweeps and rollovers add",
        "to `pool`; `end_season` freezes it into `prize_pool`; each claim takes its prize out of",
        "`pool`, and `rollover_season` moves what is left into the then-current season."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "startedAt",
            "type": "i64"
          },
          {
            "name": "endedAt",
            "type": "i64"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "prizePool",
            "docs": [
              "Prize pool frozen by `end_season`."
            ],
            "type": "u64"
          },
          {
            "name": "pool",
            "docs": [
              "Game tokens of the season vault that belong to this season and are not paid out yet."
            ],
            "type": "u64"
          },
          {
            "name": "claimedMask",
            "docs": [
              "Bit `rank` set ⇔ the prize of that rank was claimed."
            ],
            "type": "u16"
          },
          {
            "name": "count",
            "docs": [
              "Number of used leaderboard entries."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "entries",
            "docs": [
              "Sorted by `points`, descending; only `entries[..count]` are meaningful."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "leaderEntry"
                  }
                },
                20
              ]
            }
          }
        ]
      }
    },
    {
      "name": "seasonEnded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "prizePool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seasonRolledOver",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "u32"
          },
          {
            "name": "to",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "session",
      "docs": [
        "An open stake session (one per player per arena). PDA `[\"session\", arena, player]`.",
        "",
        "Its lamport balance is its rent plus `settle_fee`, both paid by the player at join: the",
        "deposit goes to the server at settlement (it pays the settle transaction), the rent back to",
        "the player. A refund returns both to the player."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "`Config::total_sessions` at join (PDAs are reused, ids are not)."
            ],
            "type": "u64"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "entryFee",
            "docs": [
              "Entry fee paid into the arena vault, in base units of the game token."
            ],
            "type": "u64"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "hasPass",
            "docs": [
              "Joined with a Slana Pass: lower fee, season points, and `pass_asset` is locked."
            ],
            "type": "bool"
          },
          {
            "name": "passAsset",
            "docs": [
              "The Pass asset backing the session (`Pubkey::default()` without a Pass)."
            ],
            "type": "pubkey"
          },
          {
            "name": "settleFee",
            "docs": [
              "Settle deposit in lamports (`Config::settle_fee_lamports` at join)."
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Fee on profit in basis points, fixed at join (`Config::pass_fee_bps` with a Pass,",
              "else `Config::fee_bps`): later fee changes never touch an open session."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "finalized",
            "docs": [
              "Settled without a player token account (ruling R24): the game result is final, the",
              "fee is taken and the Pass lock is closed, but `owed` still sits in the arena vault",
              "until the player collects it with `refund_session` (no waiting time). The session stays",
              "open (it counts in `Arena::open_sessions`, so the vault cannot be swept meanwhile)."
            ],
            "type": "bool"
          },
          {
            "name": "owed",
            "docs": [
              "Game tokens the player is owed by a finalized session (0 otherwise)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sessionRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "finalized",
            "docs": [
              "The session was finalized: `amount` is its owed payout, not an entry-fee refund."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "sessionSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "sessionId",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "burned",
            "docs": [
              "Part of `fee` that was burned."
            ],
            "type": "u64"
          },
          {
            "name": "hasPass",
            "type": "bool"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u16"
          },
          {
            "name": "owed",
            "docs": [
              "Player share left in the vault for the player to collect (finalized without a token",
              "account); 0 when it was paid in the same transaction."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "settleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "docs": [
              "`Session::id` the server is settling. Session PDAs are reused when a player joins",
              "the same arena again, so this stops a delayed/retried settlement of an old session",
              "from being applied to a newer one at the same address."
            ],
            "type": "u64"
          },
          {
            "name": "payout",
            "docs": [
              "Game-token base units the player cashed out with (taken from the arena vault, before",
              "the fee on profit)."
            ],
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u16"
          },
          {
            "name": "xp",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "treasuryWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "docs": [
        "Every `Some` field replaces the stored value; `None` keeps it. The token mint is fixed",
        "at `initialize` and cannot be changed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "serverAuthority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "feeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "passFeeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "split",
            "docs": [
              "`[treasury_bps, season_bps, burn_bps]`, must sum to `BPS`. (An array rather than a",
              "tuple because the Anchor IDL has no tuple type; the Borsh encoding is identical.)"
            ],
            "type": {
              "option": {
                "array": [
                  "u16",
                  3
                ]
              }
            }
          },
          {
            "name": "settleFeeLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "passBaseUri",
            "docs": [
              "At most `MAX_BASE_URI_LEN` bytes, ends with `/`; frozen once the first Pass is minted."
            ],
            "type": {
              "option": "string"
            }
          },
          {
            "name": "passSupply",
            "docs": [
              "`1..=MAX_PASS_SUPPLY`; frozen once the mint has opened (`SupplyLocked`)."
            ],
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "passPerWallet",
            "docs": [
              "`1..=MAX_PASS_PER_WALLET`."
            ],
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "passMinTokens",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "passMintOpen",
            "docs": [
              "`true` opens the mint (never after it ended). `false` closes it only while no Pass is",
              "minted; a started mint ends with `close_pass_mint` (`UseCloseMint`)."
            ],
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "passMintStartTs",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "arenaSeed",
      "docs": [
        "`Arena` PDA: `[\"arena\", id.to_le_bytes() (u16)]`."
      ],
      "type": "bytes",
      "value": "[97, 114, 101, 110, 97]"
    },
    {
      "name": "basicSkins",
      "docs": [
        "Number of basic skins (ids `0..BASIC_SKINS`); every player may use all of them."
      ],
      "type": "u8",
      "value": "8"
    },
    {
      "name": "bps",
      "docs": [
        "Basis-point denominator (100 %)."
      ],
      "type": "u16",
      "value": "10000"
    },
    {
      "name": "claimWindowSecs",
      "docs": [
        "Season prizes can be claimed for this many seconds after the season ended (30 days)."
      ],
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "configSeed",
      "docs": [
        "`Config` PDA: `[\"config\"]`."
      ],
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "defaultPassPerWallet",
      "docs": [
        "`Config::pass_per_wallet` set by `initialize`."
      ],
      "type": "u8",
      "value": "1"
    },
    {
      "name": "defaultPassSupply",
      "docs": [
        "`Config::pass_supply` set by `initialize`."
      ],
      "type": "u32",
      "value": "3333"
    },
    {
      "name": "entropyDelaySlots",
      "docs": [
        "Slots between the end of the Pass mint and the slot whose hash becomes the trait entropy",
        "(~1 minute at 400 ms). Whoever ends the mint cannot know that future hash."
      ],
      "type": "u64",
      "value": "150"
    },
    {
      "name": "firstSeason",
      "docs": [
        "Id of the first season (created by `initialize`)."
      ],
      "type": "u32",
      "value": "1"
    },
    {
      "name": "leaderboardSize",
      "docs": [
        "Number of entries kept on each season leaderboard."
      ],
      "type": "u8",
      "value": "20"
    },
    {
      "name": "maxArenaSessions",
      "docs": [
        "Maximum value of `Arena::max_sessions`."
      ],
      "type": "u16",
      "value": "2000"
    },
    {
      "name": "maxBaseUriLen",
      "docs": [
        "Maximum length of `Config::pass_base_uri` in bytes."
      ],
      "type": "u8",
      "value": "96"
    },
    {
      "name": "maxFeeBps",
      "docs": [
        "Upper bound for `Config::fee_bps` (10 %); `pass_fee_bps` must not exceed `fee_bps`."
      ],
      "type": "u16",
      "value": "1000"
    },
    {
      "name": "maxNameLen",
      "docs": [
        "Maximum player name length in bytes (UTF-8)."
      ],
      "type": "u8",
      "value": "16"
    },
    {
      "name": "maxPassPerWallet",
      "docs": [
        "Upper bound for `Config::pass_per_wallet`."
      ],
      "type": "u8",
      "value": "10"
    },
    {
      "name": "maxPassSupply",
      "docs": [
        "Upper bound for `Config::pass_supply`."
      ],
      "type": "u32",
      "value": "10000"
    },
    {
      "name": "maxScorePerGame",
      "docs": [
        "Score of a single game is clamped to this value."
      ],
      "type": "u32",
      "value": "1000000"
    },
    {
      "name": "maxSettleFeeLamports",
      "docs": [
        "Upper bound for `Config::settle_fee_lamports` (the per-session settle deposit)."
      ],
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "maxXpPerGame",
      "docs": [
        "XP granted by a single game is clamped to this value."
      ],
      "type": "u32",
      "value": "2000"
    },
    {
      "name": "minArenaSessions",
      "docs": [
        "Minimum value of `Arena::max_sessions`."
      ],
      "type": "u16",
      "value": "2"
    },
    {
      "name": "passAuthoritySeed",
      "docs": [
        "Data-less signer PDA that is the update authority of the Pass collection: `[\"pass_authority\"]`."
      ],
      "type": "bytes",
      "value": "[112, 97, 115, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "passLockSeed",
      "docs": [
        "Lock of a Pass asset while it backs an open session: `[\"pass_lock\", asset]`."
      ],
      "type": "bytes",
      "value": "[112, 97, 115, 115, 95, 108, 111, 99, 107]"
    },
    {
      "name": "passMintedSeed",
      "docs": [
        "Per-wallet Pass mint counter: `[\"pass_minted\", wallet]`."
      ],
      "type": "bytes",
      "value": "[112, 97, 115, 115, 95, 109, 105, 110, 116, 101, 100]"
    },
    {
      "name": "prizeRanks",
      "docs": [
        "Number of leaderboard ranks that receive a season prize."
      ],
      "type": "u8",
      "value": "10"
    },
    {
      "name": "prizeSharesBps",
      "docs": [
        "Prize share of each season rank in basis points (sums to 10 000)."
      ],
      "type": {
        "array": [
          "u16",
          10
        ]
      },
      "value": "[3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200]"
    },
    {
      "name": "profileSeed",
      "docs": [
        "`PlayerProfile` PDA: `[\"profile\", owner]`."
      ],
      "type": "bytes",
      "value": "[112, 114, 111, 102, 105, 108, 101]"
    },
    {
      "name": "seasonSeed",
      "docs": [
        "`Season` PDA: `[\"season\", id.to_le_bytes() (u32)]`."
      ],
      "type": "bytes",
      "value": "[115, 101, 97, 115, 111, 110]"
    },
    {
      "name": "seasonVaultSeed",
      "docs": [
        "Global season prize token vault (authority = the config PDA): `[\"season_vault\"]`."
      ],
      "type": "bytes",
      "value": "[115, 101, 97, 115, 111, 110, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "sessionRefundTimeoutSecs",
      "docs": [
        "A session that was never settled can be refunded by its player after this many seconds (24 h)."
      ],
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "sessionSeed",
      "docs": [
        "`Session` PDA: `[\"session\", arena, player]`."
      ],
      "type": "bytes",
      "value": "[115, 101, 115, 115, 105, 111, 110]"
    },
    {
      "name": "treasuryVaultSeed",
      "docs": [
        "Treasury token vault (authority = the config PDA): `[\"treasury_vault\"]`."
      ],
      "type": "bytes",
      "value": "[116, 114, 101, 97, 115, 117, 114, 121, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "vaultSeed",
      "docs": [
        "Token vault of an arena (authority = the arena PDA): `[\"vault\", arena]`."
      ],
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    },
    {
      "name": "xpLevelDivisor",
      "docs": [
        "`level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`."
      ],
      "type": "u64",
      "value": "50"
    }
  ]
};
