import type { GroupSummary } from './groups';

/** A drawer's first lines: "Now" (what is true) and "Next" (the one step that moves it on). */
export function SummaryBar({ summary }: { summary: GroupSummary }) {
  return (
    <section className="ad-summary" aria-label="Status now and next step" data-testid="group-summary">
      <p className="ad-summary__line">
        <span className="ad-summary__k mono">Now</span>
        <span className="ad-summary__v">{summary.now}</span>
      </p>
      <p className={`ad-summary__line${summary.next ? ' is-next' : ' is-done'}`}>
        <span className="ad-summary__k mono">Next</span>
        <span className="ad-summary__v">{summary.next ?? 'Nothing waiting here.'}</span>
      </p>
    </section>
  );
}
