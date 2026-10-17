import type { ReactNode } from 'react';
import { Kb } from '../design';
import { Link, usePath } from './router';
import { X_URL } from './settings';
import './site.css';

/** The riso wordmark: ink over a pink (and a faint teal) pass printed off register. */
export function Wordmark({ size = 'sm', as: Tag = 'span', live = false }: { size?: 'sm' | 'xl'; as?: 'span' | 'h1'; live?: boolean }) {
  return (
    <Tag className={`st-mark st-mark--${size}${live ? ' is-live' : ''}`} aria-label="Slana">
      <span className="st-mark__teal" aria-hidden="true">
        slana
      </span>
      <span className="st-mark__pink" aria-hidden="true">
        slana
      </span>
      <span className="st-mark__ink" aria-hidden="true">
        slana
      </span>
    </Tag>
  );
}

export function XIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="st-xicon">
      <path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
    </svg>
  );
}

const NAV: { href: string; label: string }[] = [
  { href: '/wl', label: 'WL' },
  { href: '/collab', label: 'Collab' },
  { href: '/docs', label: 'Guide' },
];

export function SiteHeader({ cta = true }: { cta?: boolean }) {
  const path = usePath();
  return (
    <header className="st-head">
      <div className="st-head__inner">
        <Link href="/" className="st-head__home" aria-label="Slana home">
          <Wordmark />
        </Link>
        <nav className="st-nav" aria-label="Site">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`st-nav__link mono${path === n.href ? ' is-on' : ''}`} aria-current={path === n.href ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
          <a className="st-nav__x" href={X_URL} target="_blank" rel="noreferrer" aria-label="Slana on X (@slanaio)">
            <XIcon />
          </a>
          {cta && path !== '/wl' && (
            <Link href="/wl" className="st-pill">
              Join the WL
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="st-foot">
      <div className="st-foot__tear" aria-hidden="true" />
      <div className="st-foot__inner">
        <div className="st-foot__brand">
          <Wordmark size="xl" />
          <p className="st-foot__line">Eat. Grow. Last the round.</p>
        </div>
        <nav className="st-foot__links" aria-label="Footer">
          <a href={X_URL} target="_blank" rel="noreferrer" className="st-foot__x">
            <XIcon size={20} /> <span>@slanaio</span>
          </a>
          <a href="https://slana.io" className="mono">
            slana.io
          </a>
          <Link href="/wl" className="mono">
            WL
          </Link>
          <Link href="/collab" className="mono">
            Collab
          </Link>
          <Link href="/docs" className="mono">
            Player guide
          </Link>
        </nav>
        <p className="st-foot__small mono">
          <span>Slana · 2026</span>
          <span>Printed in riso on Solana</span>
        </p>
      </div>
    </footer>
  );
}

/** A site page: paper stock, the header, the page and the footer. */
export function SitePage({ children, className, cta = true }: { children: ReactNode; className?: string; cta?: boolean }) {
  return (
    <Kb theme="paper" className={`st-root${className ? ` ${className}` : ''}`}>
      <a className="st-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader cta={cta} />
      <main id="main" className="st-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </Kb>
  );
}
