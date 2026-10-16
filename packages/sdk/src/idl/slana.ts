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
    "description": "Slana: cute coin-themed on-chain Agar.io (identity and stakes)"
  },
  "instructions": [
    {
      "name": "createArena",
      "docs": [
        "Fails with `TokenNotSet` until `set_token_mint` ran."
      ],
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
          "docs": [
            "Arenas need the game token: `TokenNotSet` until `set_token_mint` ran."
          ],
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
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the config (no token yet). Only the program's upgrade authority may call it."
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
        "Pays the entry fee into the arena vault and opens a session. Fails with `TokenNotSet`",
        "before the mint is set, with `FeeAboveLimit` if the fee rate fixed into the session",
        "exceeds `max_fee_bps` (the rate the player was shown), with `EntryFeeAboveLimit` if the",
        "arena's entry fee exceeds `max_entry_fee`, and with `SettleFeeAboveLimit` if the settle",
        "deposit exceeds `max_settle_fee`."
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
          "docs": [
            "`TokenNotSet` until `set_token_mint` ran."
          ],
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
      "name": "setTokenMint",
      "docs": [
        "Sets the game token, once, while it is unset (`TokenAlreadySet` afterwards)."
      ],
      "discriminator": [
        204,
        233,
        179,
        83,
        12,
        31,
        139,
        120
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
          "name": "tokenMint",
          "docs": [
            "The game token. Validated by `token::validate_mint` (no freeze authority, no",
            "forbidden Token-2022 extension) and stored in the config for good."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "settleSession",
      "docs": [
        "Server-signed settlement of a stake session (a death, the round bell, or an operator",
        "exit). The fee on profit goes to the fee wallet's token account. With the player's",
        "token account the payout is paid and the session closed; without it",
        "(`player_token = None`) the session is finalized with `owed` for the player to collect",
        "via `refund_session` (ruling R24)."
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
          "writable": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "playerToken",
          "docs": [
            "Any token account of the game mint owned by the player (the player creates and pays",
            "for it; the server never does). Optional (ruling R24): without it, or when the player",
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
          "name": "feeWalletToken",
          "docs": [
            "Receives the fee: any token account of the game mint owned by `config.fee_wallet`",
            "(not necessarily its associated token account). Required even when the fee is 0."
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
      "docs": [
        "Admin: moves the whole vault of a disabled arena with no open session to the fee",
        "wallet's token account."
      ],
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
          "name": "feeWalletToken",
          "docs": [
            "Any token account of the game mint owned by `config.fee_wallet`."
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
      "args": []
    },
    {
      "name": "sweepLoot",
      "docs": [
        "Server-signed: burns `amount` (at most the vault balance) of an arena vault's floor",
        "loot, while the arena runs. `amount == 0` succeeds and does nothing."
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
          "name": "tokenMint",
          "docs": [
            "Writable: the burn lowers its supply."
          ],
          "writable": true
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
      "name": "lootBurned",
      "discriminator": [
        157,
        111,
        219,
        163,
        179,
        39,
        235,
        95
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
      "name": "tokenMintSet",
      "discriminator": [
        236,
        245,
        220,
        223,
        246,
        139,
        23,
        69
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
      "name": "arenaHasOpenSessions",
      "msg": "Arena still has open sessions"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6011,
      "name": "sessionMismatch",
      "msg": "Settlement is for a different session"
    },
    {
      "code": 6012,
      "name": "mintNotAllowed",
      "msg": "Token mint is not allowed (wrong program or forbidden Token-2022 extension)"
    },
    {
      "code": 6013,
      "name": "freezeAuthorityPresent",
      "msg": "Token mint must not have a freeze authority"
    },
    {
      "code": 6014,
      "name": "arenaBusy",
      "msg": "Arena has open sessions"
    },
    {
      "code": 6015,
      "name": "invalidMaxSessions",
      "msg": "Max sessions must be between 2 and 2000"
    },
    {
      "code": 6016,
      "name": "entryFeeZero",
      "msg": "Entry fee must be greater than zero"
    },
    {
      "code": 6017,
      "name": "feeAboveLimit",
      "msg": "The fee rate is above the limit the player signed"
    },
    {
      "code": 6018,
      "name": "entryFeeAboveLimit",
      "msg": "The entry fee is above the limit the player signed"
    },
    {
      "code": 6019,
      "name": "settleFeeAboveLimit",
      "msg": "The settle deposit is above the limit the player signed"
    },
    {
      "code": 6020,
      "name": "sessionFinalized",
      "msg": "Session is already settled; the player collects the payout with refund_session"
    },
    {
      "code": 6021,
      "name": "invalidAuthority",
      "msg": "Authority must not be the default public key"
    },
    {
      "code": 6022,
      "name": "tokenNotSet",
      "msg": "The game token mint is not set yet"
    },
    {
      "code": 6023,
      "name": "tokenAlreadySet",
      "msg": "The game token mint is already set"
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
          }
        ]
      }
    },
    {
      "name": "arenaSwept",
      "docs": [
        "`sweep_arena` moved `amount` from the arena vault to the fee wallet's token account."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u16"
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
              "May change the configuration, set the token mint, and create and sweep arenas."
            ],
            "type": "pubkey"
          },
          {
            "name": "serverAuthority",
            "docs": [
              "Game server key that signs `settle_session` and `sweep_loot`."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeWallet",
            "docs": [
              "Owner of the token account that receives every fee and every swept arena vault."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "The game token ($SLANA); `Pubkey::default()` until `set_token_mint`, then fixed."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Token program owning `token_mint` (SPL Token or Token-2022); default while unset."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenDecimals",
            "docs": [
              "Decimals of `token_mint` (0 while unset)."
            ],
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
            "name": "settleFeeLamports",
            "docs": [
              "Lamports a player deposits per session to pay the server's settle transaction",
              "(≤ `MAX_SETTLE_FEE_LAMPORTS`)."
            ],
            "type": "u64"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new arena joins (settlements and refunds keep working)."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
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
            "name": "feeBps",
            "docs": [
              "Fee on stake profit in basis points (≤ `MAX_FEE_BPS`)."
            ],
            "type": "u16"
          },
          {
            "name": "settleFeeLamports",
            "docs": [
              "Settle deposit per session in lamports (≤ `MAX_SETTLE_FEE_LAMPORTS`)."
            ],
            "type": "u64"
          },
          {
            "name": "serverAuthority",
            "docs": [
              "Game server key (not the default key)."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeWallet",
            "docs": [
              "Owner of the token account that receives the fees (not the default key)."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lootBurned",
      "docs": [
        "`sweep_loot` burned `amount` from the arena vault."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u16"
          },
          {
            "name": "amount",
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
            "name": "settleFee",
            "docs": [
              "Settle deposit in lamports (`Config::settle_fee_lamports` at join)."
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Fee on profit in basis points, fixed at join (`Config::fee_bps`): later fee changes",
              "never touch an open session."
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
              "Settled without a player token account (ruling R24): the game result is final and the",
              "fee is paid, but `owed` still sits in the arena vault until the player collects it with",
              "`refund_session` (no waiting time). The session stays open (it counts in",
              "`Arena::open_sessions`, so the vault cannot be swept meanwhile)."
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
            "docs": [
              "Fee on profit, paid to the fee wallet's token account."
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
      "name": "tokenMintSet",
      "docs": [
        "`set_token_mint` stored the game token."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "docs": [
        "Every `Some` field replaces the stored value; `None` keeps it. The token mint is set",
        "with `set_token_mint` and cannot be changed here."
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
            "name": "feeWallet",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "feeBps",
            "docs": [
              "≤ `MAX_FEE_BPS`. Open sessions keep the rate fixed at their join."
            ],
            "type": {
              "option": "u16"
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
      "name": "configSeed",
      "docs": [
        "`Config` PDA: `[\"config\"]`."
      ],
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
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
      "name": "maxFeeBps",
      "docs": [
        "Upper bound for `Config::fee_bps` (10 %)."
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
      "name": "profileSeed",
      "docs": [
        "`PlayerProfile` PDA: `[\"profile\", owner]`."
      ],
      "type": "bytes",
      "value": "[112, 114, 111, 102, 105, 108, 101]"
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
