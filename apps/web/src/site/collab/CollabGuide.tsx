import { useState } from 'react';
import { InkButton, Sheet } from '../../design';
import { rafflePost } from './logic';

/** The collab guide: how the raffle works, the rules, and a post to copy. */
export function CollabGuide({ open, onClose, community, spots, deadline }: { open: boolean; onClose: () => void; community: string; spots: number | null; deadline: number | null }) {
  const post = rafflePost(community, spots, deadline);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const ta = document.getElementById('cb-raffle-post') as HTMLTextAreaElement | null;
      ta?.select();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Run your raffle." kicker="Collab guide" closeLabel="Close the guide" className="cb-guide">
      <ol className="cb-guide__steps">
        <li>
          <strong>Apply</strong> with your community and a post about Elymum on its X. We review every application by hand and DM you on X.
        </li>
        <li>
          <strong>Get your spots.</strong> Once approved, this page shows how many Elymum WL spots you have and a timer to hand them out.
        </li>
        <li>
          <strong>Post your raffle</strong> on your community&apos;s X. Use the post below or your own, with @elymum in it.
        </li>
        <li>
          <strong>Add the winners</strong> here: a name (Discord or X) and an EVM wallet (0x…) per person. Paste a whole list at once if you like. Save as you go.
        </li>
        <li>
          <strong>Submit</strong> with the link to your raffle post, before the timer ends. Submitted wallets go on the Elymum WL for the mint.
        </li>
      </ol>
      <h3 className="cb-guide__h">Rules</h3>
      <ul className="cb-guide__rules">
        <li>One X account can send up to 2 applications.</li>
        <li>The raffle runs in public, in a post on X. We need its link to take your list.</li>
        <li>One person per spot, one wallet per person.</li>
        <li>EVM wallets only (0x…). No exchange deposit addresses.</li>
        <li>No bots, no farms. We may remove wallets that look like either, and flag wallets already on another list.</li>
        <li>After you submit, the list is locked. DM @elymum on X if you need a change.</li>
      </ul>
      <h3 className="cb-guide__h">A post for your raffle</h3>
      <label className="kb-sr" htmlFor="cb-raffle-post">
        Raffle post
      </label>
      <textarea id="cb-raffle-post" className="st-input cb-guide__post" readOnly value={post} rows={10} />
      <div className="st-row">
        <InkButton variant="pink" size="sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy the post'}
        </InkButton>
        <span className="st-note" role="status">
          {copied ? 'The post is on your clipboard.' : 'It mentions @elymum and this site.'}
        </span>
      </div>
    </Sheet>
  );
}
