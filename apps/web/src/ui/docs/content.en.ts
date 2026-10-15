import { FACTS as F, type DocsContent } from './facts';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const num = (n: number): string => nf.format(n);
/** `500` → `5%`, `450` → `4.5%`. */
const pct = (bps: number): string => `${nf.format(bps / 100)}%`;
/** Lamports as SOL with every significant digit (`20000` → `0.00002`). */
const sol = (lamports: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 9 }).format(lamports / 1e9);

const [tBps, sBps, bBps] = F.fee.split;
const R = F.rules;
const S = F.server;
const sym = '$SLANA';

/** The player guide in English. Every number comes from `FACTS` (see facts.ts). */
export const docsEn = (symbol: string = sym): DocsContent => ({
  pct,
  num,
  kicker: 'Guide · Player handbook',
  title: 'Ticket, coin, receipt.',
  deck: `How Slana plays, where your money goes, what the Pass gives you and what lives on-chain: short and plain. Numbers are the defaults in the game's code; the admin can change some of them. The amounts on the ticket confirmation are the ones that count.`,
  dateline: [
    `Fee ${pct(F.fee.bps)} · Pass ${pct(F.fee.passBps)}`,
    `Cash-out ${R.cashoutS} s · Pass ${R.passCashoutS} s`,
    `${F.capacity.arena} players per room`,
    `Top ${F.season.prizeRanks} win prizes`,
  ],
  tocLabel: 'Contents',
  receipt: {
    title: 'Cash-out',
    titlePass: 'Cash-out · Pass',
    meta: 'Example · default settings',
    entry: 'Entry fee',
    cashout: 'Cash-out value',
    profit: 'Profit',
    fee: (p) => `Fee (${p} of profit)`,
    net: 'To your wallet',
    split: 'Where the fee goes',
    treasury: 'Treasury',
    season: 'Season pool',
    burn: 'Burned',
    caption: `A ${num(F.example.entry)} ${symbol} ticket cashed out at ${num(F.example.cashout)} ${symbol}`,
  },
  perkWhere: { chain: 'On-chain', server: 'Server' },
  rank: (n) => `#${n}`,
  live: (fee, passFee) => `This server's on-chain setting right now: fee ${fee}, Pass ${passFee}.`,
  colophon: `This page uses the values in the game's code. The smart contract has not been independently audited; only play with what you can afford to lose.`,
  backToTop: 'Back to top',
  sections: [
    {
      id: 'play',
      title: 'How to play',
      lede: 'Eat confetti, grow, swallow smaller coins, run from bigger ones.',
      blocks: [
        {
          kind: 'p',
          text: `You need no wallet to start: pick the Practice ticket in the lobby and press Quick Play. Your coin follows the mouse (the joystick at the bottom left on phones). Eat confetti to grow. To eat a coin you need at least ${num(R.eatRatio)} times its mass and must mostly cover it. The bigger you are, the slower you move.`,
        },
        {
          kind: 'keys',
          caption: 'Controls',
          rows: [
            { key: 'Mouse', action: 'Move (joystick on phones)' },
            { key: 'Space', action: 'Split: launch a half at runners' },
            { key: 'W', action: 'Tip out a little mass (hold to repeat)' },
            { key: 'C', action: 'Cash out (ticket rooms)' },
            { key: 'Enter', action: 'Chat' },
            { key: '1–8', action: 'Stickers (emotes)' },
            { key: 'Q', action: 'Next player while spectating' },
            { key: 'Esc', action: 'Close the chat or an open panel' },
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Rug cacti', text: 'pop big coins into pieces; small coins can hide behind them.' },
            { term: 'Airdrops', text: 'drop power-ups: Magnet, Pump, HODL Shield and Mega Bag.' },
            { term: 'Spawn shield:', text: `A fresh coin cannot be eaten for ${R.spawnShieldS} s.` },
          ],
        },
      ],
    },
    {
      id: 'rooms',
      title: 'Rooms and entry fees',
      lede: 'Practice is free, arenas take a ticket. Every arena has a fixed entry fee.',
      blocks: [
        {
          kind: 'list',
          items: [
            {
              term: 'Practice',
              text: `is free: no wallet, token or NFT. You play with bots; there are no prizes, no season points and nothing on-chain. Up to ${F.capacity.practice} players per room.`,
            },
            {
              term: 'Leagues:',
              text: `Practice is split into Rookie and Pro. Profiles at level ${S.proLevel} or above play in Pro. A Rookie game above ${num(S.promoteMaxMass)} mass or with ${S.promoteKills} player kills sends you to Pro for ${S.promotionHours} hours. Rookie bots are gentler.`,
            },
            {
              term: 'Arenas',
              text: `are accounts on-chain. Your entry fee goes into the arena's vault, an account of the program that nobody holds a private key for. Arenas are open 24/7; bots play while they are empty. A room instance holds up to ${F.capacity.arena} real players; when it is full, a new instance opens on the same vault.`,
            },
            { term: 'One ticket:', text: 'You can hold one open ticket per arena at a time. Each arena also caps how many tickets are open at once.' },
          ],
        },
        {
          kind: 'table',
          caption: 'Default arenas',
          head: ['No', 'Room', 'Entry fee', 'Pass'],
          numeric: [0, 2],
          rows: F.arenas.map((a) => [String(a.id), a.name.en, `${num(a.entry)} ${symbol}`, a.pass ? 'required' : 'not needed']),
        },
        {
          kind: 'p',
          text: "The admin can change fees, open new arenas or close one; the current fee is printed on the ticket in the lobby. An arena's fee and Pass rule cannot change while it has open tickets (an on-chain rule).",
        },
        {
          kind: 'p',
          text: `A ticket needs a wallet, at least the entry fee in ${symbol} and a little SOL: the network fee, the payout deposit and the ticket account's rent (it comes back when the ticket closes). Your first ticket also opens your on-chain profile and, if needed, your ${symbol} token account in the same transaction; you pay their rent and the accounts stay yours.`,
        },
      ],
    },
    {
      id: 'value',
      title: 'Value flow and loot',
      lede: 'In a ticket room your coin carries tokens. Eat a player and their tokens move to you.',
      blocks: [
        {
          kind: 'flow',
          label: 'How value moves',
          steps: [
            { title: 'Entry', text: 'Your value starts at the entry fee.' },
            { title: 'Eating', text: "An eaten cell moves its share of the victim's value to the eater: ⌊V · m / M⌋. The last cell moves everything left." },
            { title: 'Cash-out', text: 'Your value, minus the fee on profit, goes to your wallet.' },
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Bots are always worth 0.', text: 'Eating a bot gives mass, never tokens. Bots are marked in the room standings.' },
            {
              term: 'If a bot eats you,',
              text: `the value you lose turns into loot coins scattered on the map: ⌈V ÷ (fee / ${R.lootEntryDiv})⌉ pieces, at least ${R.lootMin} and at most ${R.lootMax}. The pieces add up exactly to the value lost.`,
            },
            { term: 'Loot', text: 'never despawns. Only real players can pick it up; bots pass through it.' },
            { term: 'Mass is not value.', text: 'Tipping mass (W), cactus pops and mass decay do not change your value; value only changes hands by eating.' },
            { term: 'If you disconnect,', text: `your coin stays in the arena for ${R.afkS} s. Come back and you carry on; otherwise you are cashed out automatically.` },
            { term: 'If you die,', text: 'your value goes to the player who ate you, or to loot if a bot did. The ticket closes and its account rent comes back to you.' },
            { term: 'Time limit:', text: `A ticket plays for at most ${S.maxTicketHours} hours; then the server cashes you out automatically.` },
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          stamp: 'Vault',
          title: 'A payout never exceeds the vault',
          text: "Every value in play (live coins, loot on the floor, payouts waiting to be sent) is backed by the tokens in the arena's vault. The program never pays out more than the vault holds. The server writes live values and loot to disk on every change; if it crashes, open tickets are cashed out automatically.",
        },
      ],
    },
    {
      id: 'cashout',
      title: 'Cash-out and fees',
      lede: `Press C (the cash-out button on phones), survive ${R.cashoutS} s, get your receipt.`,
      blocks: [
        {
          kind: 'p',
          text: `A cash-out takes ${R.cashoutS} s, ${R.passCashoutS} s on a Pass ticket. If one of your cells is eaten meanwhile, the cash-out is cancelled; if you are eaten completely, you lose your value. When it completes the server sends the payout on-chain and the receipt shows the transaction link.`,
        },
        {
          kind: 'p',
          text: `The fee is charged on profit only: profit = cash-out value − entry fee. At a loss or break-even there is no fee. The default rate is ${pct(F.fee.bps)}, ${pct(F.fee.passBps)} on a Pass ticket; the program caps it at ${pct(F.fee.maxBps)}.`,
        },
        { kind: 'fee-example' },
        {
          kind: 'p',
          text: `The fee is split three ways (defaults): ${pct(tBps)} to the treasury (the team's income), ${pct(sBps)} to the season prize pool and ${pct(bBps)} burned (removed from the token supply for good). Rounding leftovers go to the season pool.`,
        },
        {
          kind: 'list',
          items: [
            {
              term: 'Deposit:',
              text: `When you buy a ticket you put a small SOL deposit on the ticket account (default ${num(F.settleFeeLamports)} lamports = ◎${sol(F.settleFeeLamports)}). The server sends the payout transaction and the deposit pays its network fee, so the server wallet spends nothing net on it.`,
            },
            { term: 'Rent:', text: "The ticket account's rent (and the Pass lock's, if you entered with a Pass) comes back to you when the ticket closes." },
            { term: 'Unplayed ticket:', text: `If you buy a ticket and never enter the room, the server closes it at its entry fee after about ${S.staleTicketMinutes} minutes (no profit, so no fee).` },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Token account',
          title: 'Your payout needs a token account',
          text: `The server never pays rent for player accounts. If you have no ${symbol} token account, the payout is not lost, it waits: the lobby shows a "create token account" prompt (≈◎0.002 rent, paid by you, the account is yours). Once it exists the payout arrives within ${S.noAtaRetryMinutes} minutes. If the server never closes your ticket, you can refund it yourself ${F.refundHours} hours after it opened: your entry fee (if the vault holds it) and all the SOL, deposit included, come back.`,
        },
      ],
    },
    {
      id: 'pass',
      title: 'Slana Pass',
      lede: 'A free-mint NFT. It opens the Pass rooms, lowers the fee, earns season prizes and gives in-game power.',
      blocks: [
        {
          kind: 'perks',
          items: [
            { title: 'Pass rooms', text: "Pass-only arenas sell tickets only to Pass holders. The program checks the Pass's owner and collection.", where: 'chain' },
            { title: `${pct(F.fee.passBps)} fee`, text: `A Pass ticket pays ${pct(F.fee.passBps)} of profit (${pct(F.fee.bps)} without).`, where: 'chain' },
            { title: 'Season points and prizes', text: 'Season points come only from Pass tickets, so only Pass players reach the prize table.', where: 'chain' },
            {
              title: `+${pct(R.passStartPct * 100)} start, ${R.passCashoutS} s cash-out`,
              text: `With a Pass ticket in an arena (and wearing a Pass in practice) you start with +${pct(R.passStartPct * 100)} mass and cash out in ${R.passCashoutS} s (normally ${R.cashoutS} s).`,
              where: 'server',
            },
            { title: 'Coin look', text: "Your Pass's risograph coin becomes your look in the game; the server verifies you own it.", where: 'server' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Disclosure',
          title: 'The Pass gives in-game power',
          text: `A Pass ticket starts with +${pct(R.passStartPct * 100)} mass and cashes out in ${R.passCashoutS} s (normally ${R.cashoutS} s). That is a real edge over players without a Pass in the same room. The mint is free, but Passes trade for money on marketplaces, so the edge can be bought: it is close to pay-to-win. Tickets say so plainly. The values are server settings; the admin can change or switch them off.`,
        },
        {
          kind: 'list',
          items: [
            { term: 'Opt-in:', text: 'Using your Pass in an arena that does not require one is your choice. Pick "Enter with my Pass" on the ticket confirmation and the perks apply to that ticket.' },
            {
              term: 'Lock:',
              text: 'A Pass backs one ticket at a time. The lock lifts when the ticket closes (cash-out, death or refund) and its rent comes back to you. Even if you transfer the Pass mid-game, the new owner cannot use it until the lock lifts.',
            },
            { term: 'Fixed at purchase:', text: 'The Pass perks are written on-chain when you buy the ticket; buying or selling a Pass later does not change an open ticket.' },
          ],
        },
      ],
    },
    {
      id: 'mint',
      title: 'Mint and reveal',
      lede: `The Pass is free: no ${symbol}, only account rent and the network fee in SOL.`,
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the application form on the Pass tab. While the mint is open you see the supply left and a counter.',
            `Sign with your wallet. The transaction creates a new NFT; numbers are sequential (#1, #2, …). No ${symbol} should leave your wallet, only SOL (rent and network fee). The mint sheet shows the exact amount before you sign; the rent stays with the NFT and does not come back.`,
            'Your Pass arrives sealed in an envelope. Its look and traits are revealed for the whole collection at once when the mint closes.',
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Supply:', text: `${num(F.pass.supply)} Passes by default; ${F.pass.perWallet} per wallet.` },
            { term: 'Conditions:', text: `The admin may set a start time and, optionally, a minimum ${symbol} balance to mint (default: none).` },
            {
              term: 'Fair reveal (commit–reveal):',
              text: "Before the mint starts, the admin writes the hash (sha256) of a secret seed on-chain. When the mint closes or sells out, the admin reveals the seed and the program checks it against the hash. Every Pass's traits are computed from that seed and its number, so after the reveal anyone can verify them and the seed cannot be swapped. After the reveal the mint can never reopen.",
            },
            { term: 'Look:', text: 'Until the reveal every Pass shows as a "sealed passport" in the game and on marketplaces. The Pass page links the marketplaces when the admin has set them.' },
          ],
        },
      ],
    },
    {
      id: 'seasons',
      title: 'Seasons',
      lede: `Score with Pass tickets, reach the top ${F.season.prizeRanks}, claim your share of the pool.`,
      blocks: [
        {
          kind: 'list',
          items: [
            {
              term: 'Points',
              text: `come only from arena games played with a Pass ticket, whether you cash out or die. A game scores the highest mass you reached (capped at ${num(F.season.maxScore)} per game), added up over the season.`,
            },
            { term: 'The table', text: `lives on-chain and shows the top ${F.season.boardSize}; the top ${F.season.prizeRanks} win prizes.` },
            { term: 'The pool', text: `fills from the season share of player fees (default ${pct(sBps)}) and from leftovers of closed arenas. The team does not fund it.` },
            { term: 'The end:', text: 'A season has no fixed end time on-chain. The admin ends it; the pool is frozen at that moment and the next season starts.' },
            {
              term: 'Claiming:',
              text: `You claim your prize yourself on the Ranks page, within ${F.season.claimDays} days after the season ends. After that the admin rolls unclaimed prizes into the running season's pool.`,
            },
          ],
        },
        { kind: 'prizes', caption: 'Prize shares (percent of the frozen pool)' },
      ],
    },
    {
      id: 'fair',
      title: 'Fair play and transparency',
      lede: 'The money rules are on-chain, the game itself runs on a server. Know what you trust.',
      blocks: [
        {
          kind: 'compare',
          left: {
            title: 'On-chain: program rules anyone can verify',
            items: [
              "Entry fees sit in the arena's vault; a payout can never exceed it.",
              `Fees only on profit, capped at ${pct(F.fee.maxBps)}. The split, the burn and the season pool.`,
              'Every ticket has a unique id, so an old payout cannot be applied to a new ticket.',
              `Self-refund after ${F.refundHours} hours.`,
              'The Pass gate, the Pass lock, mint limits and commit–reveal.',
              `The season table, prize shares and the ${F.season.claimDays}-day claim window.`,
            ],
          },
          right: {
            title: 'On the server: you trust it',
            items: [
              'Physics and the outcome: who ate whom, what you were worth at cash-out. The server signs the payout amount.',
              'Score, XP and kill counts (season points come from them).',
              'Bots, matchmaking and leagues.',
              'Pass power and checking the Pass you wear.',
              "The server's Today / All-time boards and the chat filter.",
            ],
          },
        },
        {
          kind: 'p',
          text: "The server key can only close open tickets: it pays from an arena's vault and cannot touch the treasury, the season vault or the settings. A buggy or malicious server could still split an arena's vault wrongly between players. This hybrid model, standard for real-time games, requires trusting the server.",
        },
        {
          kind: 'p',
          text: `The admin can change settings (fee at most ${pct(F.fee.maxBps)}), stop new ticket sales (payouts and refunds keep working), close arenas, end seasons, withdraw the treasury and replace the server key, so trusting the server ultimately means trusting the admin. The admin cannot move arena vaults to themselves: a closed arena's leftover can only be swept into the season pool. Before the reveal only the admin knows the Pass seed. Feeding each other from two wallets (collusion) is not detected in this version.`,
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Unaudited',
          title: 'The smart contract is not audited',
          text: 'The program has not been through an independent security audit. Only play with what you can afford to lose.',
        },
      ],
    },
    {
      id: 'wallet',
      title: 'Wallet safety',
      lede: 'Read before you sign. Slana never asks for your secret recovery phrase.',
      blocks: [
        {
          kind: 'list',
          items: [
            { term: 'Sign-in', text: '(verification) is only a message signature: it starts with "Slana wants you to sign in with your Solana account", sends no transaction and costs nothing.' },
            { term: 'A ticket transaction', text: `should show only the entry fee in ${symbol} and small SOL amounts (network fee, deposit, rent). If you see more, do not sign.` },
            { term: 'A mint transaction', text: `should move no ${symbol}; only SOL (rent and fee).` },
            { term: 'Anyone asking', text: 'for your recovery phrase or private key, site, person or "support", is a scammer.' },
            { term: 'Use a separate wallet', text: 'for games and keep only what you want to play with in it.' },
            { term: 'Links:', text: 'Check the address bar. Do not click "airdrop" or "mint" links sent in DMs.' },
          ],
        },
      ],
    },
    {
      id: 'faq',
      title: 'FAQ',
      lede: 'Short answers.',
      blocks: [
        {
          kind: 'faq',
          items: [
            { q: 'Do I need a wallet for practice?', a: 'No. Practice is free; no wallet, token or NFT needed.' },
            {
              q: `Where do I get ${symbol}?`,
              a: 'On a decentralized exchange. Check the correct mint address only through official channels; the program accepts the single mint recorded once at setup.',
            },
            { q: 'Do I earn tokens by eating bots?', a: 'No. Bots are always worth 0; you only gain mass.' },
            { q: 'I lost my connection or closed the tab.', a: `Your coin stays in the arena for ${R.afkS} s. Come back in time and you carry on; otherwise you are cashed out automatically.` },
            { q: 'I bought a ticket but never played.', a: `The server closes it at its entry fee after about ${S.staleTicketMinutes} minutes. If it does not, refund it yourself after ${F.refundHours} hours.` },
            {
              q: 'My payout has not arrived.',
              a: `Check the pending payout banner in the lobby. If you have no token account, create one; the payout follows within ${S.noAtaRetryMinutes} minutes. On network trouble the server retries by itself. If it never arrives, refund the ticket after ${F.refundHours} hours.`,
            },
            { q: 'Why are my season points not growing?', a: 'Points only come from arena games played with a Pass ticket. Practice and tickets without a Pass score nothing.' },
            { q: 'What if I sell my Pass?', a: 'If it is locked to an open ticket, the new owner cannot use it until the lock lifts. Your open ticket keeps its Pass perks, which were written when you bought it.' },
            { q: 'Who gets the fee?', a: `By default ${pct(tBps)} goes to the treasury, ${pct(sBps)} to the season pool and ${pct(bBps)} is burned.` },
            {
              q: 'Is this gambling?',
              a: 'It is a skill game played with a token of real value, and many countries may regulate it. Make sure playing is legal where you are. Season prizes and burns are not a promise of returns.',
            },
          ],
        },
      ],
    },
  ],
});
