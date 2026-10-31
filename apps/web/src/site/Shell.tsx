import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { CoinMark, Icon, Kb, RingScene, Wordmark as InkWordmark, type IconName } from '../design';
import { FooterLife } from './FooterLife';
import { usePeelLetters } from './peel';
import { Link, usePath } from './router';
import { siteHost, useSiteSettings, xProfile } from './settings';
import './site.css';

// the wallet (viem, EIP-6963) loads in its own chunk, after the page has painted
const HeaderConnect = lazy(() => import('./HeaderConnect').then((m) => ({ default: m.HeaderConnect })));

/**
 * The ELYMUM wordmark for site pages: the hand-built ink letters from the design system
 * (`size` sm = header, xl = hero). `live` lets the letters hop once on load and on hover.
 */
export function Wordmark({ size = 'sm', as: Tag = 'span', live = false }: { size?: 'sm' | 'xl'; as?: 'span' | 'h1'; live?: boolean }) {
  return (
    <Tag className={`st-mark st-mark--${size}${live ? ' is-live' : ''}`}>
      <InkWordmark height={size === 'xl' ? 112 : 30} playful={live} className="st-mark__art" />
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

/**
 * A site link drawn as a Storybook button (`kb-btn`): primary sun, secondary cream, teal or
 * ghost. Same press as the design-system Button, but it navigates.
 */
export function SiteLinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  lead,
  children,
  className,
  external = false,
  ...rest
}: {
  href: string;
  variant?: 'primary' | 'secondary' | 'teal' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  lead?: IconName;
  children: ReactNode;
  className?: string;
  external?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  const iconSize = size === 'lg' ? 24 : size === 'md' ? 20 : 16;
  const cls = `kb-btn kb-btn--${variant} kb-btn--${size} st-btn${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      {lead && <Icon name={lead} size={iconSize} className="kb-btn__lead" />}
      <span className="kb-btn__label">
        <span className="kb-btn__text">{children}</span>
      </span>
      {icon && <Icon name={icon} size={iconSize} className="kb-btn__icon" />}
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}

/** The site nav: two plates of the landing, then the pages. */
const NAV: { href: string; label: string }[] = [
  { href: '/#feast', label: 'The feast' },
  { href: '/#arenas', label: 'Arenas' },
  { href: '/mint', label: 'Mint' },
  { href: '/wl', label: 'WL' },
  { href: '/docs', label: 'Docs' },
];

function ConnectFallback() {
  return (
    <button type="button" className="kb-btn kb-btn--secondary kb-btn--md st-connect" disabled aria-busy="true">
      <Icon name="wallet" size={20} className="kb-btn__lead" />
      <span className="kb-btn__label">
        <span className="kb-btn__text">Connect</span>
      </span>
    </button>
  );
}

export function SiteHeader({ cta: _cta = true, children }: { cta?: boolean; /** Extras hung under the header line (the landing's seed rail). */ children?: ReactNode }) {
  const path = usePath();
  const peel = usePeelLetters<HTMLSpanElement>();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu]);
  const links = NAV.map((n) => {
    const on = !n.href.includes('#') && path === n.href;
    return (
      <Link
        key={n.href}
        href={n.href}
        className={`st-nav__link${on ? ' is-on' : ''}`}
        aria-current={on ? 'page' : undefined}
        onClick={() => setMenu(false)}
      >
        {n.label}
      </Link>
    );
  });
  return (
    <header className="st-head">
      <div className="st-head__inner">
        <Link href="/" className="st-head__home" aria-label="Elymum home">
          <CoinMark size={38} className="st-head__coin" />
          <span ref={peel.ref} className={peel.className}>
            <Wordmark />
          </span>
        </Link>
        <nav className="st-nav" aria-label="Site">
          {links}
        </nav>
        <div className="st-head__tools">
          <Suspense fallback={<ConnectFallback />}>
            <HeaderConnect />
          </Suspense>
          <button
            type="button"
            className="st-menu-btn"
            aria-expanded={menu}
            aria-controls="st-menu"
            aria-label={menu ? 'Close the menu' : 'Open the menu'}
            onClick={() => setMenu((m) => !m)}
          >
            <Icon name={menu ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>
      {menu && (
        <nav id="st-menu" className="st-menu kb-sticker kb-sticker--cream" aria-label="Site menu">
          {links}
        </nav>
      )}
      {children}
    </header>
  );
}

export function SiteFooter() {
  const { settings } = useSiteSettings();
  const handle = settings.xHandle.replace(/^@/, '');
  return (
    <Kb theme="night" paper={false} className="st-foot-kb">
    <footer className="st-foot">
      <RingScene time="night" variant="horizon" clouds={false} animate={false} className="st-foot__ring" />
      <FooterLife />
      <div className="st-foot__inner">
        <div className="st-foot__brand">
          <InkWordmark height={64} diecut playful={false} className="st-foot__mark" />
          <p className="st-foot__line">Small change, big appetite. Five minutes at a time.</p>
          <p className="st-foot__eco">
            Played on <strong>Elysium</strong>, the ring habitat in the Kinetiq ecosystem. Gas is HYPE. An independent game; the ring just lets us eat on it.
          </p>
        </div>
        <nav className="st-foot__links" aria-label="Footer">
          <a href={xProfile(handle)} target="_blank" rel="noreferrer" className="st-foot__x">
            <XIcon size={18} /> <span>@{handle}</span>
          </a>
          <Link href="/mint">Mint</Link>
          <Link href="/wl">WL</Link>
          <Link href="/collab">Collab</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <p className="st-foot__small mono">
          <span>Elymum · 2026</span>
          <span>{siteHost()}</span>
          <span>Never DMs first. Never asks for a seed phrase.</span>
        </p>
      </div>
    </footer>
    </Kb>
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
