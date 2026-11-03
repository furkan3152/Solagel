import { useState } from 'react';
import { Button, Sheet, Tape } from '../../design';
import { useLocale, useT } from '../../i18n';
import { strong, T } from '../../i18n/rich';
import { rafflePost } from './logic';

/** The collab guide: how the raffle works, the rules, and a post to copy. */
export function CollabGuide({ open, onClose, community, spots, deadline }: { open: boolean; onClose: () => void; community: string; spots: number | null; deadline: number | null }) {
  const t = useT();
  useLocale();
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
    <Sheet open={open} onClose={onClose} title={t('cb.g.title')} kicker={t('cb.g.kicker')} closeLabel={t('cb.g.close')} className="cb-guide">
      <ol className="cb-guide__steps">
        {[1, 2, 3, 4, 5].map((n) => (
          <li key={n}>
            <T k={`cb.g.step${n}` as 'cb.g.step1'} tags={{ strong }} />
          </li>
        ))}
      </ol>
      <h3 className="cb-guide__h">{t('cb.g.rules')}</h3>
      <ul className="cb-guide__rules">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <li key={n}>{t(`cb.g.rule${n}` as 'cb.g.rule1')}</li>
        ))}
      </ul>
      <h3 className="cb-guide__h">{t('cb.g.postH')}</h3>
      <div className="cb-guide__note">
        <Tape rotate={-4} width={80} />
        <label className="kb-sr" htmlFor="cb-raffle-post">
          {t('cb.g.postLabel')}
        </label>
        <textarea id="cb-raffle-post" className="cb-guide__post" readOnly value={post} rows={10} />
      </div>
      <div className="wl-row">
        <Button variant="primary" size="sm" lead={copied ? 'check' : undefined} onClick={() => void copy()}>
          {copied ? t('cb.g.copied') : t('cb.g.copy')}
        </Button>
        <span className="wl-note" role="status">
          {copied ? t('cb.g.onClip') : t('cb.g.mentions')}
        </span>
      </div>
    </Sheet>
  );
}
