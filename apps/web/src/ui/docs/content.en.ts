import { FACTS as F, feeExample, type DocsContent } from './facts';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const num = (n: number): string => nf.format(n);
/** `500` → `5%`, `450` → `4.5%`. */
const pct = (bps: number): string => `${nf.format(bps / 100)}%`;

const S = F.server;
const R = F.rules;
const sym = '$ELYMUM';

/**
 * The player guide in English. Every number comes from `FACTS` (see facts.ts); the fee rate is
 * the server's `feeBps` (the arena contract's `config().feeBps`) when known, else the contract default.
 */
export const docsEn = (symbol: string = sym, feeBps: number = F.fee.bps): DocsContent => {
  const ex = feeExample(feeBps);
  return {
  pct,
  num,
  kicker: 'Guide · Player handbook',
  title: 'Ticket, coin, receipt.',
  deck: `How Elymum plays, where your money goes and what lives on-chain: short and plain. Numbers are the defaults in the game's code; the admin can change some of them. The amounts on the ticket confirmation are the ones that count.`,
  feeBps,
  dateline: [
    `Fee ${pct(feeBps)} of profit`,
    `Rounds ${R.roundMin} min · joins close ${R.joinCloseS} s before the bell`,
    `${F.capacity.arena} players per room`,
    'Floor loot burned at the bell',
  ],
  tocLabel: 'Contents',
  receipt: {
    title: 'Round over',
    meta: `Example · fee ${pct(feeBps)} of profit`,
    entry: 'Entry fee',
    cashout: 'Till at the bell',
    profit: 'Profit',
    fee: (p) => `Fee (${p} of profit)`,
    net: 'To your wallet',
    footer: "The fee goes to the operator's wallet",
    caption: `A ${num(F.example.entry)} ${symbol} ticket with ${num(F.example.cashout)} ${symbol} in the till at the bell`,
  },
  colophon: `This page uses the values in the game's code. The smart contract has not been independently audited; only play with what you can afford to lose.`,
  backToTop: 'Back to top',
  sections: [
    {
      id: 'play',
      title: 'How to play',
      lede: 'Eat food, grow, swallow smaller coins, run from bigger ones.',
      blocks: [
        {
          kind: 'p',
          text: `You need no wallet to start: pick the Practice ticket in the lobby and press Quick Play. Your coin follows the mouse (the joystick at the bottom left on phones). Eat food (pears, grapes, seeds) to grow. To eat a coin you need at least ${num(R.eatRatio)} times its mass and must mostly cover it. The bigger you are, the slower you move.`,
        },
        {
          kind: 'keys',
          caption: 'Controls',
          rows: [
            { key: 'Mouse', action: 'Move (joystick on phones)' },
            { key: 'Space', action: 'Split: launch a half at runners' },
            { key: 'W', action: 'Tip out a little mass (hold to repeat)' },
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
              text: `is free: no wallet, token or NFT. You play with bots; there are no prizes and nothing on-chain. Up to ${F.capacity.practice} players per room.`,
            },
            {
              term: 'Leagues:',
              text: `Practice is split into Rookie and Pro. Profiles at level ${S.proLevel} or above play in Pro. A Rookie game above ${num(S.promoteMaxMass)} mass or with ${S.promoteKills} player kills sends you to Pro for ${S.promotionHours} hours. Rookie bots are gentler.`,
            },
            {
              term: 'Arenas',
              text: `live in one smart contract on Elysium. Your entry fee goes into the arena's vault inside that contract; nobody holds a key that can withdraw it. Arenas are open 24/7 and play in rounds (see Rounds and payout); bots play while they are empty. A room instance holds up to ${F.capacity.arena} real players; when it is full, a new instance opens on the same vault.`,
            },
            { term: 'One ticket:', text: 'You can hold one open ticket per arena at a time. Each arena also caps how many tickets are open at once.' },
            {
              term: 'Opening soon:',
              text: `The arenas open once the admin has set the ${symbol} token on-chain (this happens once, after launch, and can never change). Until then the lobby shows the arenas as "Opening soon", no ticket can be bought and practice is open. The lobby opens the arenas by itself the moment the token is set; no reload is needed.`,
            },
          ],
        },
        {
          kind: 'table',
          caption: 'Default arenas (open to everyone; they differ only by entry fee)',
          head: ['No', 'Room', 'Entry fee'],
          numeric: [0, 2],
          rows: F.arenas.map((a) => [String(a.id), a.name, `${num(a.entry)} ${symbol}`]),
        },
        {
          kind: 'p',
          text: "The admin can change the fee, open new arenas or close one; the current fee is printed on the ticket in the lobby. The fee rate is fixed on-chain when you buy a ticket: a later change only applies to tickets bought after it. An arena's entry fee cannot change while it has open tickets (an on-chain rule).",
        },
        {
          kind: 'p',
          text: `A ticket needs an EVM wallet (MetaMask, Rabby or any browser wallet), at least the entry fee in ${symbol} and a little HYPE on Elysium for network fees. Buying takes at most two signatures: the first allows the arena to take exactly the entry fee (only when it is not allowed yet), the second buys the ticket. Your name and coin live on your profile on the game server, not on chain.`,
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
            { title: 'The bell', text: 'When the round ends, your value, minus the fee on profit, goes to your wallet.' },
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
            { term: 'Loot', text: 'stays on the floor until the bell, when it is burned. Only real players can pick it up; bots pass through it.' },
            { term: 'Mass is not value.', text: 'Tipping mass (W), cactus pops and mass decay do not change your value; value only changes hands by eating.' },
            { term: 'If you disconnect,', text: `your coin stays in the arena (it can still be eaten) and you carry on if you come back. If you are still alive at the bell, you are paid as usual.` },
            { term: 'If you die,', text: 'your value goes to the player who ate you, or to loot if a bot did. The ticket closes.' },
            { term: 'No early exit:', text: 'There is no cash-out in an arena. Your till is paid only when the round ends; a ticket never outlives its round.' },
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          stamp: 'Vault',
          title: 'A payout never exceeds the vault',
          text: "Every value in play (live coins, loot on the floor, payouts waiting to be sent) is backed by the tokens in the arena's vault. The contract never pays out more than the vault holds. The server writes live values and loot to disk on every change; if it crashes, open tickets are settled automatically at their last saved value. Loot still on the floor at the bell is burned from the arena vault.",
        },
      ],
    },
    {
      id: 'payout',
      title: 'Rounds, payout and fees',
      lede: `Arenas play ${R.roundMin}-minute rounds. Stay alive until the bell and you are paid your value.`,
      blocks: [
        {
          kind: 'p',
          text: `Rounds follow the clock: a new one starts every ${R.roundMin} minutes, at the same moment in every arena. There is no cash-out in an arena and no way to leave early with money. When the bell rings, everyone still alive is paid their current value, the server sends the payout on-chain and the "Round over" receipt shows the transaction link. If you are eaten completely, you lose your value; whoever ate you keeps it.`,
        },
        {
          kind: 'p',
          text: `You can join a running round at the same entry fee, and if you were eaten you may buy a new ticket and re-enter the same round. Joins close ${R.joinCloseS} s before the bell. A ticket bought in that window is not lost: the lobby holds it and the game joins automatically when the next round opens. Loot still on the floor at the bell is burned: it leaves the token supply for good.`,
        },
        {
          kind: 'p',
          text: `The fee is charged on profit only: profit = till at the bell − entry fee. At a loss or break-even there is no fee. The rate is ${pct(feeBps)} of profit; the contract caps it at ${pct(F.fee.maxBps)}. The rate is written into your ticket when you buy it, and the payout uses that rate even if the admin changes the setting meanwhile. Example: entry ${num(F.example.entry)}, till at the bell ${num(F.example.cashout)}, fee ${num(Number(ex.fee))}, you get ${num(Number(ex.player))}.`,
        },
        { kind: 'fee-example' },
        {
          kind: 'p',
          text: "The whole fee goes to the operator's wallet (the fee wallet set in the arena contract); it is the team's income. Nothing else is taken from your payout.",
        },
        {
          kind: 'list',
          items: [
            { term: 'Network fees:', text: 'You pay the HYPE network fee of your own transactions (buying, refunding, collecting). The server pays the network fee of every payout.' },
            { term: 'Unplayed ticket:', text: `If you buy a ticket and never enter the room, the server closes it at its entry fee after about ${S.staleTicketMinutes} minutes (no profit, so no fee).` },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Collect',
          title: 'Transfer refused? Your game still settles',
          text: `If the ${symbol} transfer to your wallet fails when your game ends, the server settles the game anyway: the fee is taken from the profit and your payout stays in the arena vault, recorded on your ticket. The lobby then shows "Collect payout": one transaction pays you the exact amount. There is no waiting time, and nobody else can take it. Only a ticket the server never settled at all can be refunded, ${F.refundHours} hours after it opened: your entry fee comes back (if the vault holds it).`,
        },
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
            title: 'On-chain: contract rules anyone can verify',
            items: [
              "Entry fees sit in the arena's vault; a payout can never exceed it.",
              `Fees only on profit, capped at ${pct(F.fee.maxBps)}, paid to the fee wallet.`,
              'Floor loot swept at the bell is burned.',
              'Every ticket has a unique id, so an old payout cannot be applied to a new ticket.',
              `Collecting a settled payout at any time; a self-refund of an unsettled ticket after ${F.refundHours} hours.`,
              'The fee rate of each ticket, fixed when it is bought.',
              `The ${symbol} token, set once by the admin and never changed.`,
            ],
          },
          right: {
            title: 'On the server: you trust it',
            items: [
              'Physics and the outcome: who ate whom, what you were worth at the bell. The server signs the payout amount.',
              'Score, XP and kill counts.',
              'Bots, matchmaking and leagues.',
              "The server's Today / All-time standings (for bragging rights, no prizes) and the chat filter.",
            ],
          },
        },
        {
          kind: 'p',
          text: "The server key can only close open tickets and burn floor loot: it pays from an arena's vault, burns round-end loot from the vault (never more than the vault holds) and cannot touch the fee wallet or the settings. A buggy or malicious server could still split an arena's vault wrongly between players. This hybrid model, standard for real-time games, requires trusting the server.",
        },
        {
          kind: 'p',
          text: `The admin can change settings (fee at most ${pct(F.fee.maxBps)}), change the fee wallet, stop new ticket sales (payouts and refunds keep working), close arenas and replace the server key, so trusting the server ultimately means trusting the admin. The admin cannot take an open arena's vault: only an arena that is closed and has no open tickets can be swept, and its leftover goes to the fee wallet. Feeding each other from two wallets (collusion) is not detected in this version.`,
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Unaudited',
          title: 'The smart contract is not audited',
          text: 'The contracts have not been through an independent security audit. Only play with what you can afford to lose.',
        },
      ],
    },
    {
      id: 'wallet',
      title: 'Wallet safety',
      lede: 'Read before you sign. Elymum never asks for your secret recovery phrase.',
      blocks: [
        {
          kind: 'list',
          items: [
            { term: 'Sign-in', text: '(verification) is only a message signature: it names this site, says "wants you to sign in with your Ethereum account" and "Sign in to Elymum. This is free and sends no transaction.", sends no transaction and costs nothing.' },
            { term: 'A ticket', text: `takes at most two transactions: an approval for exactly the entry fee in ${symbol}, then the ticket itself, each with a small HYPE network fee. If your wallet asks for an unlimited approval or for more, do not sign.` },
            { term: 'Anyone asking', text: 'for your recovery phrase or private key, site, person or "support", is a scammer.' },
            { term: 'Use a separate wallet', text: 'for games and keep only what you want to play with in it.' },
            { term: 'Links:', text: 'Check the address bar. Do not click "airdrop" or "mint" links sent in DMs: the only mint is the Mint page of this site.' },
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
              a: 'On a decentralized exchange. Check the correct token address only through official channels; the arena contract accepts the single token the admin sets once, after launch.',
            },
            {
              q: 'Why do the arenas say "Opening soon"?',
              a: `The ${symbol} token is not set on-chain yet. Practice is open; the arenas open by themselves as soon as the admin sets the token.`,
            },
            { q: 'Do I earn tokens by eating bots?', a: 'No. Bots are always worth 0; you only gain mass.' },
            { q: 'I lost my connection or closed the tab.', a: `Your coin stays in the arena and can still be eaten. Come back and you carry on; if it is still alive at the bell, you are paid as usual.` },
            { q: 'Can I cash out early?', a: `No. Arenas have no cash-out: you are paid your value when the ${R.roundMin}-minute round ends.` },
            { q: 'I bought a ticket but never played.', a: `The server closes it at its entry fee after about ${S.staleTicketMinutes} minutes. If it does not, refund it yourself after ${F.refundHours} hours.` },
            {
              q: 'My payout has not arrived.',
              a: `Check the payout banner in the lobby. If it says "Collect payout", your game is settled and the payout waits in the vault: collect it with one transaction, right away. If it says the payout is on the way, the server is still sending it and retries by itself on network trouble.`,
            },
            { q: 'Who gets the fee?', a: `The operator's wallet gets the whole fee (${pct(feeBps)} of profit). Floor loot left at the bell is burned.` },
            { q: 'Are there prizes for the Standings?', a: 'No. The Today and All-time standings are kept by the game server for fun; they pay nothing.' },
            {
              q: 'Is this gambling?',
              a: 'It is a skill game played with a token of real value, and many countries may regulate it. Make sure playing is legal where you are. Burns are not a promise of returns.',
            },
          ],
        },
      ],
    },
  ],
};
};
