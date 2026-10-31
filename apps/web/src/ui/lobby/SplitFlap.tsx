/**
 * Departures-board letters: each character sits on its own little flap card (a hinge line
 * across the middle, a darker lower leaf), and a character that changes flips down onto
 * the new one, like the boards in an old station hall. Only the cells that changed move
 * (keyed by character), so a clock ticking once a second flips one card. Reduced motion:
 * the cards just change (lobby.css). Screen readers get the plain text.
 */
export function SplitFlap({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`sf${className ? ` ${className}` : ''}`}>
      <span className="kb-sr">{text}</span>
      <span className="sf__cells" aria-hidden="true">
        {[...text].map((ch, i) =>
          ch === ':' || ch === ' ' || ch === '.' ? (
            <span key={`p${i}`} className="sf__sep">
              {ch}
            </span>
          ) : (
            <span key={`c${i}`} className="sf__cell">
              <span key={ch} className="sf__ch">
                {ch}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
