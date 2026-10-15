import { useMemo, useRef } from 'react';
import { Chip, Dateline, Icon, Receipt, Rule, Stamp, useReducedMotion, type ReceiptLine } from '../../design';
import { useChainData } from '../../solana/chain';
import { useUi } from '../../store';
import { useTokenText } from '../lobby/useLobby';
import { PageHead } from '../PageHead';
import { docsEn } from './content.en';
import { FACTS, type DocBlock, type DocsContent } from './facts';
import './docs.css';

/**
 * The player guide (`/docs`, `#docs`): how to play, rooms, value flow, fees,
 * the Pass, mint, seasons, what is on-chain, wallet safety and an FAQ. Typed
 * content lives in content.en.ts; every number comes from the code through facts.ts.
 */
export function DocsPage() {
  const tok = useTokenText();
  const power = useUi((s) => s.chain?.passPower ?? null);
  const c = useMemo(() => docsEn(tok.symbol, power), [tok.symbol, power]);
  const config = useChainData((s) => s.config);
  const reduced = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);

  const jump = (id: string) => {
    const el = document.getElementById(`docs-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  };

  const live = config && (config.feeBps !== FACTS.fee.bps || config.passFeeBps !== FACTS.fee.passBps) ? c.live(c.pct(config.feeBps), c.pct(config.passFeeBps)) : null;

  return (
    <div className="dc-page" ref={top}>
      <PageHead kicker={c.kicker} title={c.title} deck={c.deck} id="dc-title" aside={<Stamp text="Guide" sub="Player copy" tone="teal" round size="md" rotate={-6} />} />
      <Dateline items={c.dateline} label={c.tocLabel} className="dc-dateline" />

      <div className="dc-layout">
        <nav className="dc-toc" aria-label={c.tocLabel}>
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
                {s.blocks.map((b, j) => (
                  <Block key={j} block={b} c={c} live={s.id === 'cashout' ? live : null} />
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

function Block({ block: b, c, live }: { block: DocBlock; c: DocsContent; live: string | null }) {
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
    case 'steps':
      return (
        <ol className="dc-steps">
          {b.items.map((it, i) => (
            <li key={i}>
              <span className="dc-steps__no mono" aria-hidden="true">
                {i + 1}
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ol>
      );
    case 'keys':
      return (
        <figure className="dc-keys-fig">
          <figcaption className="dc-cap mono" id="dc-keys-cap">
            {b.caption}
          </figcaption>
          <table className="dc-keys" aria-labelledby="dc-keys-cap">
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <kbd className="dc-kbd mono">{r.key}</kbd>
                  </th>
                  <td>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      );
    case 'table':
      return (
        <div className="dc-table-wrap">
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
        <ol className="dc-flow" aria-label={b.label}>
          {b.steps.map((s, i) => (
            <li key={i} className="dc-flow__step">
              <span className="dc-flow__title mono">{s.title}</span>
              <span className="dc-flow__text">{s.text}</span>
              {i < b.steps.length - 1 && <Icon name="arrow" size={20} className="dc-flow__arrow" />}
            </li>
          ))}
        </ol>
      );
    case 'fee-example':
      return <FeeExample c={c} live={live} />;
    case 'perks':
      return (
        <ul className="dc-perks">
          {b.items.map((p, i) => (
            <li key={i} className="dc-perk">
              <div className="dc-perk__head">
                <strong className="dc-perk__title">{p.title}</strong>
                <Chip tone={p.where === 'chain' ? 'teal' : 'mustard'} icon={p.where === 'chain' ? 'lock' : 'globe'}>
                  {c.perkWhere[p.where]}
                </Chip>
              </div>
              <p className="dc-perk__text">{p.text}</p>
            </li>
          ))}
        </ul>
      );
    case 'compare':
      return (
        <div className="dc-compare">
          {[b.left, b.right].map((col, i) => (
            <div key={i} className={`dc-compare__col${i === 0 ? ' is-chain' : ' is-server'}`}>
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
        <aside className={`dc-note is-${b.tone}`} aria-label={b.title}>
          <Stamp text={b.stamp} tone={b.tone === 'warn' ? 'red' : 'teal'} size="sm" rotate={-4} className="dc-note__stamp" />
          <h4 className="dc-note__title">{b.title}</h4>
          <p className="dc-note__text">{b.text}</p>
        </aside>
      );
    case 'prizes':
      return (
        <figure className="dc-prizes">
          <figcaption className="mono">{b.caption}</figcaption>
          <ol className="dc-prizes__list">
            {FACTS.season.shares.map((bps, i) => (
              <li key={i} className={i < 3 ? 'is-podium' : undefined}>
                <span className="dc-prizes__rank mono">{c.rank(i + 1)}</span>
                <span className="dc-prizes__pct">{c.pct(bps)}</span>
              </li>
            ))}
          </ol>
        </figure>
      );
    case 'faq':
      return (
        <div className="dc-faq">
          {b.items.map((it, i) => (
            <details key={i} className="dc-faq__item">
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

/** The worked example: a 1.000-token ticket cashed out at 2.000, without and with a Pass. */
function FeeExample({ c, live }: { c: DocsContent; live: string | null }) {
  const { entry, cashout, normal, pass } = FACTS.example;
  const r = c.receipt;
  const n = (v: bigint | number) => c.num(Number(v));
  const lines = (split: typeof normal, bps: number): ReceiptLine[] => [
    { label: r.entry, value: n(entry) },
    { label: r.cashout, value: n(cashout) },
    { label: r.profit, value: n(cashout - entry) },
    { label: r.fee(c.pct(bps)), value: `−${n(split.fee)}`, muted: true },
    { label: r.net, value: n(split.player), strong: true },
  ];
  const foot = (split: typeof normal) => `${r.split}: ${r.treasury} ${n(split.treasury)} · ${r.season} ${n(split.season)} · ${r.burn} ${n(split.burn)}`;
  return (
    <figure className="dc-fee">
      <figcaption className="dc-fee__cap mono">{r.caption}</figcaption>
      <div className="dc-fee__slips">
        <Receipt title={r.title} meta={r.meta} lines={lines(normal, FACTS.fee.bps)} footer={foot(normal)} className="dc-fee__slip" />
        <Receipt title={r.titlePass} meta={r.meta} lines={lines(pass, FACTS.fee.passBps)} footer={foot(pass)} className="dc-fee__slip is-pass" />
      </div>
      {live && <p className="dc-fee__live mono">{live}</p>}
    </figure>
  );
}
