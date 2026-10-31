# Elymum gameplay film: the narration

About 120 s, recorded from the real UI: it opens on the home page and goes into a live round in
Asphodel Meadow. One voice tells the story: a warm, witty narrator who has seen a few rounds and
is on your side. The humour is dry: it is in what's said, never in a funny voice. The sentences are
short and the pauses do half the work.

- **Spoken lines:** `vo-lines.json` (the TTS input, in the same format as `media/promo/audio/vo-lines.json`).
- **Timeline:** `cues.json` (picture beats, VO cues, SFX cues, music sections).
- **For a human reader:** `script-for-voice-actor.md` (one page).

The marks: `|` a breath (a short catch, not a full stop), `||` a beat (about 0.4 s), `{0.5}` a
timed pause, `*word*` emphasis. Speed is per line (1.0 = a relaxed conversational pace, about 155
words a minute).

## The read

**Who is talking.** Picture someone telling a friend how a game works, over a drink, slightly
amused by all of it. They are not selling anything. They don't push, they don't rise at the end
of every sentence, and they let a joke land by stopping, not by leaning on it.

**What to avoid.** The trailer voice. The "announcer" lift on every last word. Smiling so hard
that it can be heard on every line. Reading the punctuation instead of the thought.

**Rhythm.** Mix it up: a long line, then two short ones. The short lines ("Leave.", "Dinner.",
"Then play.") are the punchlines: give them the beat before and say them plainly.

## Cue list

Times are film seconds. The picture beats come from `cues.json`; the "ends ~" times are the
placeholder read's (2.7 words a second plus the marked pauses). A real read will differ a little,
and `audio/mix.py` warns when a line runs into the next one.

| # | Beat | VO at | Line | Ends ~ | SFX and music around it |
|---|---|---|---|---|---|
| 1 | `[home hero]` 0.0 | 1.0 | hook_a | 4.8 | music box and felt piano, alone |
| 2 | `[home hero]` | 5.6 | hook_b | 9.0 | |
| 3 | `[the feast]` 10.0 | 11.0 | what_a | 15.2 | whoosh 9.55 (the scroll) |
| 4 | `[a round, in orbit]` 17.5 | 16.2 | what_b | 20.8 | |
| 5 | `[a round, in orbit]` | 21.6 | what_c | 26.9 | harp joins |
| 6 | `[WL page]` 27.5, `[mint page]` 31.0 | 28.0 | flow | 35.4 | whoosh 27.1, stamp 30.4 (WL), whoosh 30.6, stamp 34.9 (the minted sticker); walking bass and brushes in |
| 7 | `[enter lobby]` 37.5, `[ticket]` 41.0 | 37.9 | lobby | 42.1 | whoosh 37.05, ticket punch 41.4 |
| 8 | `[drop in]` 45.0 | 45.7 | drop | 49.9 | whoosh down 44.3; the pulse starts (bassoon, pizzicato) |
| 9 | `[first eat]` 50.5 | 51.3 | first_eat | 56.9 | chomp 50.5, nibble 54.3 |
| 10 | `[threat]` 57.5 | 58.0 | run | 62.6 | whoosh 57.3 |
| 11 | `[split]` 65.0 | 65.5 | split_a | 69.8 | one beat of silence in the music at 64.4, harp run, whoosh 64.85 |
| 12 | `[split pays]` 70.3 | 71.4 | split_b | 74.3 | chomp 70.3 |
| 13 | `[final minute]` 77.5 | 78.0 | final_a | 84.3 | D minor, string tremolo, timpani roll |
| 14 | `[final minute]` | 85.4 | final_b | 88.8 | the rise keeps climbing |
| 15 | `[ten seconds]` 90.0 | 90.6 | ten | 97.1 | the music drops to a heartbeat each second (it lines up with the game's own ticks) |
| — | `[bell]` 100.0 | — | (no voice) | — | the bell 100.0 + the music's hit (F major tutti); 120 ms of near silence before it |
| 16 | `[paid]` 102.5 | 103.3 | paid | 110.2 | PAID stamp 102.6; the motif comes home |
| 17 | `[end card]` 110.0 | 111.0 | close | 116.2 | whoosh 109.6, stamp 110.4, cadence and sting, ring-out to 120 |

## The lines, with direction

**1 · hook_a** `[home hero]` (speed 0.94)
> You are small change. || With a *big* appetite.

Intent: an introduction, slightly conspiratorial, as if the viewer is the coin. Emphasis: *big*.
Pace: unhurried; the beat after "change" is a smile, not a gap. Don't land "appetite" heavily.

**2 · hook_b** `[home hero]` (0.98)
> Which, | around here, | is a perfectly good career.

Intent: the first dry joke. Say it as plain fact. Emphasis: a little on "perfectly". Pace:
conversational; the two breaths are tiny, the sentence still flows.

**3 · what_a** `[the feast]` (0.96)
> This is Elymum. || Coins eat coins, | on Elysium's ring.

Intent: the name, said warmly, once. "Coins eat coins" is matter-of-fact, almost a shrug. Emphasis:
"Elymum" (EL-ih-mum), then nothing loud. Pace: a touch slower; the beat lets the name land.

**4 · what_b** `[a round, in orbit]` (1.0)
> Rounds last *five* minutes. | One bell, | for every arena at once.

Intent: the rule, crisp. Emphasis: *five*. Pace: even, a little brisker than the line before.

**5 · what_c** `[a round, in orbit]` (0.98)
> When it rings, | whoever's still alive gets paid. || Whoever isn't {0.35} was lunch.

Intent: the stakes, then the joke. Emphasis: "paid" lightly; "lunch" not at all (deadpan). Pace:
hold the pause before "was lunch", keep the voice up through "isn't" so it is a suspended thought,
not two sentences.

**6 · flow** `[WL page]` then `[mint page]` (1.02)
> Getting in is short. || Join the WL. | Mint your Elymum NFT, | one dollar in HYPE. || Then play.

Intent: practical, three steps, no fuss. Emphasis: "one dollar". Pace: brisk on the steps; "Then
play." alone, with a small lift, as the payoff. WL is spoken "double-u L"; HYPE is "hype".

**7 · lobby** `[enter lobby]` (1.0)
> Pick a room. | Buy a ticket. || In you go.

Intent: a friend holding the door. Emphasis: none. Pace: two quick steps, then "In you go" warmer,
a fraction slower. The ticket punch lands in the beat.

**8 · drop** `[drop in]` (0.98)
> Right. | You're the little one. || Don't take it personally.

Intent: sympathy with a wink. "Right." is the narrator taking stock. Emphasis: "little". Pace: the
last sentence a bit softer and slower, almost an aside.

**9 · first_eat** `[first eat]` (1.0)
> Smaller than you? || *Dinner.* || And whatever they were worth | is yours now.

Intent: the first pleasure of the game. "Dinner." is the punchline: flat, satisfied, short.
Emphasis: *Dinner*, then "yours". Pace: question, beat, the word, beat, then easy.

**10 · run** `[threat]` (1.04)
> Bigger than you? || Leave. | Don't make eye contact. | Just leave.

Intent: urgent advice, but still dry. Emphasis: "Leave", both times, the second one quieter.
Pace: quicker than the line before; the three short sentences are a little list.

**11 · split_a** `[split]` (1.04)
> Press space, | and you split in two. || One half lunges.

Intent: a trick shared. Emphasis: "split", then "lunges" with a little energy. Pace: keep it
moving; the beat is where the lunge happens on screen.

**12 · split_b** `[split pays]` (1.0)
> The other half | tries to look casual.

Intent: a gag about the half left behind. Emphasis: "casual", lightly. Pace: slower and drier than
split_a, a hint of a smile.

**13 · final_a** `[final minute]` (0.96)
> Final minute. || Joins close. | Nobody new gets in, | and everyone gets a little *careful.*

Intent: the mood shifts; lower and closer. Emphasis: *careful*. Pace: slower; "Final minute." is
a statement, not an announcement.

**14 · final_b** `[final minute]` (1.0)
> Big coins slow down. | Small coins get ideas.

Intent: the twist that makes the final minute fun. Emphasis: "ideas". Pace: an even pair; the
second half slightly lighter, conspiratorial.

**15 · ten** `[ten seconds]` (1.0)
> Ten seconds. || Keep your head down. {0.5} Coins don't have heads. | Keep it down anyway.

Intent: tension and a joke inside it. Emphasis: "down" in the last sentence. Pace: "Ten seconds."
quiet and close; the half-second pause before the correction; then the last line plainly. Finish
by 97 s so the last ticks and the bell have the air.

**16 · paid** `[paid]` (0.98)
> Still here at the bell? || Then it's *yours.* | Paid out, | minus five percent of the profit.

Intent: the reward, warm and honest. Emphasis: *yours*. Pace: relaxed; the fee is said plainly, as
a fact that is fine to hear, not small print.

**17 · close** `[end card]` (0.94)
> Elymum. || Join the WL. | Follow *@elymum.* || And bring an appetite.

Intent: a sign-off, a small callback to the first line. Emphasis: "@elymum" ("at Elymum"). Pace:
slowest of the film; the last line soft, with a smile you can just about hear.

## Facts the lines rely on

All from `docs/PROJECT.md` and the spec: rounds are 5 minutes on the wall clock for every arena;
at the bell every live ticket is paid its value on chain minus a fee on profit only (5 % by
default); joins close in the final minute; bigger coins are slower (speed falls with radius);
split is `Space` (a button on phones); the flow is WL → Mint ($1 in HYPE) → Play; the X handle is
@elymum. If the fee or the handle changes in the admin settings, lines 16 and 17 change with it.
