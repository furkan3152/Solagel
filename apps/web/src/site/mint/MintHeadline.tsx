import type { PriceStory } from './logic';

/**
 * The headline and lede, honest about the price: on a testnet the fixed test price (and that
 * mainnet is much cheaper); the "one dollar" story only while the price really tracks a dollar;
 * otherwise the HYPE price as it stands.
 */
export function MintHeadline({ story, price }: { story: PriceStory; price: string | null }) {
  if (story === 'testnet')
    return (
      <>
        <h1 className="mt-h display" data-story="testnet">
          One emblem.
          <br />
          {price ? (
            <>
              <em>{price} HYPE</em> on testnet.
            </>
          ) : (
            <>
              A <em>testnet</em> mint.
            </>
          )}
          <br />
          Many snacks.
        </h1>
        <p className="mt-lede">
          Your emblem is your ticket to the ring. {price ? <>Testnet mint: {price} HYPE, a fixed test price paid in test HYPE.</> : 'The testnet mint is paid in test HYPE.'} We do the arithmetic;
          you do the eating.
        </p>
        <p className="mt-note" data-testid="mt-mainnet-note">
          The mainnet mint will be much cheaper.
        </p>
      </>
    );
  if (story === 'dollar')
    return (
      <>
        <h1 className="mt-h display" data-story="dollar">
          One emblem.
          <br />
          One <em>dollar.</em>
          <br />
          Many snacks.
        </h1>
        <p className="mt-lede">
          Your emblem is your ticket to the ring. The price is pinned to a dollar and paid in HYPE, so the number on the button wiggles with the market. We do the arithmetic; you do the
          eating.
        </p>
      </>
    );
  return (
    <>
      <h1 className="mt-h display" data-story="plain">
        One emblem.
        <br />
        {price ? (
          <>
            <em>{price} HYPE.</em>
          </>
        ) : (
          <>
            Paid in <em>HYPE.</em>
          </>
        )}
        <br />
        Many snacks.
      </h1>
      <p className="mt-lede">Your emblem is your ticket to the ring. The price is set on the contract and paid in HYPE. We do the arithmetic; you do the eating.</p>
    </>
  );
}
