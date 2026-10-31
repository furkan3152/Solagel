import { useMemo, useRef } from 'react';
import { CoinCharacter, Dateline, Icon, Receipt, Rule, Stamp, useOffscreenPause, useReducedMotion, type ReceiptLine } from '../../design';
import { feeBps } from '../../wallet/ticket';
import { useUi } from '../../store';
import { useTokenText } from '../lobby/useLobby';
import { PageHead } from '../PageHead';
import { docsEn } from './content.en';
import { EXAMPLE, feeExample, type DocBlock, type DocsContent } from './facts';
import { ComicStrip } from './Comics';
import { ValueFlow } from './ValueFlow';
import './docs.css';

/**
 * The player guide (`/docs`, `#docs`): how to play, rooms, value flow, rounds and
 * fees, what is on-chain, wallet safety and an FAQ. Typed content lives in
 * content.en.ts; every number comes from the code through facts.ts, and the fee
 * rate is the server's (`ChainStatus.feeBps`) when it is known.
 */
export function DocsPage() {
  const tok = useTokenText();
  const serverBps = useUi((s) => s.chain?.feeBps ?? null);
  const bps = feeBps(serverBps);
  const c = useMemo(() => docsEn(tok.symbol, bps), [tok.symbol, bps]);
  const reduced = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);

  const jump = (id: string) => {
    const el = document.getElementById(`docs-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  };

  return (
    <div className="dc-page" ref={top}>
      <PageHead
        kicker={c.kicker}
        title={c.title}
        deck={c.deck}
        id="dc-title"
        aside={
          <span className="dc-head__art">
            <CoinCharacter paint="cream" mood="smug" size={124} look={[-3, 1]} feet ground bob />
            <Stamp text="Guide" sub="Player copy" tone="teal" round size="md" rotate={-8} className="dc-head__stamp" />
          </span>
        }
      />
      <Dateline items={c.dateline} label={c.tocLabel} className="dc-dateline" />

      <div className="dc-layout">
        <nav className="dc-toc kb-island" aria-label={c.tocLabel}>
          <span className="dc-toc__label mono">{c.tocLabel}</span>
          <ol className="dc-toc__list">
            {c.sections.map((s, i) => (
              <li key={s.id}>
                <button type="button" className="dc-toc__item" onClick={() => jump(s.id)}>
                  <span className="dc-toc__no mono" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="dc-toc__title">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="dc-body" aria-labelledby="dc-title">
          {c.sections.map((s, i) => (
            <section key={s.id} id={`docs-${s.id}`} className="dc-sec" aria-labelledby={`docs-${s.id}-h`}>
              <header className="dc-sec__head">
                <span className="dc-sec__no mono" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="dc-sec__titles">
                  <h3 id={`docs-${s.id}-h`} className="dc-sec__title" tabIndex={-1}>
                    {s.title}
                  </h3>
                  <p className="dc-sec__lede">{s.lede}</p>
                </div>
              </header>
              <div className="dc-sec__body">
                {s.strip && <ComicStrip id={s.id} strip={s.strip} />}
                {s.blocks.map((b, j) => (
                  <Block key={j} block={b} c={c} />
                ))}
              </div>
            </section>
          ))}

          <Rule variant="double" />
          <footer className="dc-foot">
            <p className="dc-foot__text">{c.colophon}</p>
            <button
              type="button"
              className="dc-top"
              onClick={() => {
                top.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                document.getElementById('dc-title')?.focus({ preventScroll: true });
              }}
            >
              <Icon name="arrow" size={18} className="dc-top__icon" />
              <span>{c.backToTop}</span>
            </button>
          </footer>
        </article>
      </div>
    </div>
  );
}

function Block({ block: b, c }: { block: DocBlock; c: DocsContent }) {
  switch (b.kind) {
    case 'p':
      return <p className="dc-p">{b.text}</p>;
    case 'list':
      return (
        <ul className="dc-list">
          {b.items.map((it, i) =>
            typeof it === 'string' ? (
              <li key={i}>{it}</li>
            ) : (
              <li key={i}>
                <strong>{it.term}</strong> {it.text}
              </li>
            ),
          )}
        </ul>
      );
    case 'keys':
      return <KeysFig caption={b.caption} rows={b.rows} />;
    case 'table':
      return (
        <div className="dc-table-wrap kb-island">
          <table className="dc-table">
            <caption className="mono">{b.caption}</caption>
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className={b.numeric?.includes(i) ? 'is-num' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className={b.numeric?.includes(j) ? 'is-num mono' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'flow':
      return (
        <>
          {b.diagram && <ValueFlow labels={b.diagram} />}
          <ol className="dc-flow" aria-label={b.label}>
            {b.steps.map((s, i) => (
              <li key={i} className="dc-flow__step kb-island">
                <span className="dc-flow__no num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="dc-flow__title mono">{s.title}</span>
                <span className="dc-flow__text">{s.text}</span>
                {i < b.steps.length - 1 && <Icon name="arrow" size={20} className="dc-flow__arrow" />}
              </li>
            ))}
          </ol>
        </>
      );
    case 'fee-example':
      return <FeeExample c={c} />;
    case 'compare':
      return (
        <div className="dc-compare">
          {[b.left, b.right].map((col, i) => (
            <div key={i} className={`dc-compare__col kb-island${i === 0 ? ' is-chain' : ' is-server'}`}>
              <h4 className="dc-compare__title">
                <Icon name={i === 0 ? 'lock' : 'globe'} size={18} />
                {col.title}
              </h4>
              <ul className="dc-list">
                {col.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'note':
      return (
        <aside className={`dc-note kb-island is-${b.tone}`} aria-label={b.title}>
          <Stamp text={b.stamp} tone={b.tone === 'warn' ? 'red' : 'teal'} size="sm" rotate={-4} className="dc-note__stamp" />
          <h4 className="dc-note__title">{b.title}</h4>
          <p className="dc-note__text">{b.text}</p>
        </aside>
      );
    case 'faq':
      return (
        <div className="dc-faq">
          {b.items.map((it, i) => (
            <details key={i} className="dc-faq__item kb-island">
              <summary className="dc-faq__q">
                <span>{it.q}</span>
                <Icon name="chevron" size={18} className="dc-faq__chev" />
              </summary>
              <p className="dc-faq__a">{it.a}</p>
            </details>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/** The controls as key stickers that press themselves one after another (paused off screen). */
function KeysFig({ caption, rows }: { caption: string; rows: { key: string; action: string }[] }) {
  const [ref, visible] = useOffscreenPause<HTMLElement>();
  return (
    <figure ref={ref} className="dc-keys-fig kb-island" data-paused={!visible || undefined}>
      <figcaption className="dc-cap mono" id="dc-keys-cap">
        {caption}
      </figcaption>
      <table className="dc-keys" aria-labelledby="dc-keys-cap">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <th scope="row">
                <kbd className="dc-kbd mono" style={{ ['--i' as string]: i }}>
                  {r.key}
                </kbd>
              </th>
              <td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** The worked example: a 1,000-token ticket with 2,000 in the till at the bell, at the server's fee rate. */
function FeeExample({ c }: { c: DocsContent }) {
  const { entry, cashout } = EXAMPLE;
  const split = feeExample(c.feeBps);
  const r = c.receipt;
  const n = (v: bigint | number) => c.num(Number(v));
  const lines: ReceiptLine[] = [
    { label: r.entry, value: n(entry) },
    { label: r.cashout, value: n(cashout) },
    { label: r.profit, value: n(cashout - entry) },
    { label: r.fee(c.pct(c.feeBps)), value: `−${n(split.fee)}`, muted: true },
    { label: r.net, value: n(split.player), strong: true },
  ];
  return (
    <figure className="dc-fee">
      <figcaption className="dc-fee__cap mono">{r.caption}</figcaption>
      <div className="dc-fee__slips">
        <Receipt title={r.title} meta={r.meta} lines={lines} footer={r.footer} className="dc-fee__slip" />
      </div>
    </figure>
  );
}
