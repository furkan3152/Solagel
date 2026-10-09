/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solagel.json`.
 */
export type Solagel = {
  "address": "5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472",
  "metadata": {
    "name": "solagel",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solagel: cute coin-themed on-chain Agar.io (identity, stakes, seasons, prizes)"
  },
  "instructions": [
    {
      "name": "buySkin",
      "discriminator": [
        160,
        172,
        148,
        145,
        46,
        58,
        70,
        228
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "profile"
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
          "name": "treasury",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "skin",
          "type": "u8"
        }
      ]
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
          "writable": true,
          "signer": true
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
          "name": "buyIn",
          "type": "u64"
        },
        {
          "name": "maxPlayers",
          "type": "u16"
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
      "name": "fundSeason",
      "discriminator": [
        251,
        186,
        193,
        242,
        15,
        144,
        254,
        67
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
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
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the config and season 1. Only the program's upgrade authority may call it."
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
          "name": "session",
          "docs": [
            "One open session per player per arena: a second join fails because the PDA exists."
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "recordGame",
      "docs": [
        "Server-signed free-play result."
      ],
      "discriminator": [
        247,
        120,
        117,
        224,
        181,
        219,
        180,
        52
      ],
      "accounts": [
        {
          "name": "server",
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
                "path": "profile.owner",
                "account": "playerProfile"
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
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "recordArgs"
            }
          }
        }
      ]
    },
    {
      "name": "refundSession",
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
      "name": "settleSession",
      "docs": [
        "Server-signed cash-out of a stake session."
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
          "name": "player",
          "writable": true,
          "relations": [
            "session"
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
          "name": "treasury",
          "writable": true
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
          "name": "treasury",
          "writable": true
        }
      ],
      "args": []
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
          "name": "maxPlayers",
          "type": {
            "option": "u16"
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
      "name": "gameRecorded",
      "discriminator": [
        148,
        119,
        18,
        172,
        198,
        62,
        150,
        145
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
      "name": "seasonFunded",
      "discriminator": [
        86,
        2,
        211,
        175,
        10,
        250,
        20,
        35
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
      "name": "skinPurchased",
      "discriminator": [
        120,
        227,
        216,
        6,
        255,
        113,
        22,
        85
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
      "name": "skinLocked",
      "msg": "Skin is locked"
    },
    {
      "code": 6006,
      "name": "skinAlreadyOwned",
      "msg": "Skin already owned"
    },
    {
      "code": 6007,
      "name": "buyInTooLow",
      "msg": "Buy-in is below the minimum"
    },
    {
      "code": 6008,
      "name": "invalidMaxPlayers",
      "msg": "Max players must be between 2 and 100"
    },
    {
      "code": 6009,
      "name": "arenaDisabled",
      "msg": "Arena is disabled"
    },
    {
      "code": 6010,
      "name": "arenaFull",
      "msg": "Arena is full"
    },
    {
      "code": 6011,
      "name": "insufficientPot",
      "msg": "Amount exceeds the available pot"
    },
    {
      "code": 6012,
      "name": "refundTooEarly",
      "msg": "Session cannot be refunded yet"
    },
    {
      "code": 6013,
      "name": "seasonFinalized",
      "msg": "Season is already finalized"
    },
    {
      "code": 6014,
      "name": "seasonNotFinalized",
      "msg": "Season is not finalized"
    },
    {
      "code": 6015,
      "name": "notEligible",
      "msg": "Not eligible for a season reward"
    },
    {
      "code": 6016,
      "name": "alreadyClaimed",
      "msg": "Reward already claimed"
    },
    {
      "code": 6017,
      "name": "claimWindowClosed",
      "msg": "Claim window is closed"
    },
    {
      "code": 6018,
      "name": "claimWindowOpen",
      "msg": "Claim window is still open"
    },
    {
      "code": 6019,
      "name": "invalidSeason",
      "msg": "Invalid season"
    },
    {
      "code": 6020,
      "name": "arenaHasOpenSessions",
      "msg": "Arena still has open sessions"
    },
    {
      "code": 6021,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6022,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6023,
      "name": "sessionMismatch",
      "msg": "Settlement is for a different session"
    }
  ],
  "types": [
    {
      "name": "arena",
      "docs": [
        "A stake arena tier. PDA `[\"arena\", id.to_le_bytes()]`.",
        "",
        "The arena account itself is the vault: every lamport above its rent-exempt",
        "minimum belongs to the pot."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "buyIn",
            "type": "u64"
          },
          {
            "name": "maxPlayers",
            "type": "u16"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "openSessions",
            "type": "u16"
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
            "name": "buyIn",
            "type": "u64"
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
              "May change the configuration, create arenas and manage seasons."
            ],
            "type": "pubkey"
          },
          {
            "name": "serverAuthority",
            "docs": [
              "Game server key that signs `settle_session` and `record_game`."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Receives skin purchases, the treasury part of fees and swept arena leftovers."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`)."
            ],
            "type": "u16"
          },
          {
            "name": "seasonShareBps",
            "docs": [
              "Part of the fee that goes to the current season prize pool, in basis points."
            ],
            "type": "u16"
          },
          {
            "name": "skinPrice",
            "docs": [
              "Price of a premium skin in lamports."
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
      "name": "gameRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
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
      "name": "initializeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "serverAuthority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "seasonShareBps",
            "type": "u16"
          },
          {
            "name": "skinPrice",
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
              "Equipped skin id."
            ],
            "type": "u8"
          },
          {
            "name": "premiumSkins",
            "docs": [
              "Owned premium skins: bit `i` set ⇔ skin `PREMIUM_SKIN_START + i` owned."
            ],
            "type": "u32"
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
      "name": "recordArgs",
      "type": {
        "kind": "struct",
        "fields": [
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
        "Every lamport above the rent-exempt minimum is prize money."
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
      "name": "seasonFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "funder",
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
        "An open stake session (one per player per arena). PDA `[\"session\", arena, player]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
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
            "name": "buyIn",
            "type": "u64"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "id",
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
            "name": "score",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u16"
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
              "Lamports the player cashed out with (taken from the arena pot)."
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
      "name": "skinPurchased",
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
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "docs": [
        "Every `Some` field replaces the stored value; `None` keeps it."
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
            "name": "treasury",
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
            "name": "seasonShareBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "skinPrice",
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
      "name": "firstSeason",
      "docs": [
        "Id of the first season (created by `initialize`)."
      ],
      "type": "u32",
      "value": "1"
    },
    {
      "name": "freeSkins",
      "docs": [
        "Skins `0..FREE_SKINS` are free."
      ],
      "type": "u8",
      "value": "8"
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
      "name": "levelSkinRequirements",
      "docs": [
        "Level required by level-gated skins (skin 8 needs level 2 … skin 15 needs level 20)."
      ],
      "type": {
        "array": [
          "u32",
          8
        ]
      },
      "value": "[2, 3, 5, 7, 10, 13, 16, 20]"
    },
    {
      "name": "levelSkinStart",
      "docs": [
        "Skins `LEVEL_SKIN_START..PREMIUM_SKIN_START` are unlocked by level."
      ],
      "type": "u8",
      "value": "8"
    },
    {
      "name": "maxArenaPlayers",
      "docs": [
        "Maximum value of `Arena::max_players`."
      ],
      "type": "u16",
      "value": "100"
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
      "name": "maxXpPerGame",
      "docs": [
        "XP granted by a single game is clamped to this value."
      ],
      "type": "u32",
      "value": "2000"
    },
    {
      "name": "minArenaPlayers",
      "docs": [
        "Minimum value of `Arena::max_players`."
      ],
      "type": "u16",
      "value": "2"
    },
    {
      "name": "minBuyIn",
      "docs": [
        "Minimum arena buy-in (0.001 SOL)."
      ],
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "premiumSkinStart",
      "docs": [
        "Skins `PREMIUM_SKIN_START..SKIN_COUNT` are bought with SOL (bit `skin - 16` of `premium_skins`)."
      ],
      "type": "u8",
      "value": "16"
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
      "name": "skinCount",
      "docs": [
        "Total number of skins (ids `0..SKIN_COUNT`)."
      ],
      "type": "u8",
      "value": "24"
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
