import type { ChainStatus } from '@elymum/shared';
import { useEffect } from 'react';
import { SERVER } from '../config';
import { PlateLabel } from '../design';
import { useUi } from '../store';
import { DocsPage } from '../ui/docs/DocsPage';
import { useT } from '../i18n';
import { SitePage } from './Shell';
import '../ui/lobby/lobby.css';

/** `/docs`: the player guide, public, inside the site (no game engine). The fee rate comes from `/api/config`. */
export function DocsRoute() {
  const t = useT();
  useEffect(() => {
    let live = true;
    fetch(`${SERVER.http}/api/config`)
      .then((r) => (r.ok ? (r.json() as Promise<{ chain?: ChainStatus }>) : null))
      .then((c) => {
        if (live && c?.chain) useUi.setState({ chain: c.chain });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <SitePage className="st-docs">
      <PlateLabel numeral={8} title={t('site.docs.plate')} aside="/docs" className="st-docs__plate" />
      <div className="st-page">
        <DocsPage />
      </div>
    </SitePage>
  );
}
