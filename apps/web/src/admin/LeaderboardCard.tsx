import { useCallback, useEffect, useState } from 'react';
import { SiteApiError, type LeaderboardAdminInfo } from '../site/api';
import { Btn, Card, type ChainCtx } from './ui';

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Game → leaderboards: what the daily and all-time boards hold, and a reset (admin session). The server
 * keeps a backup of the file next to it; profiles (XP, levels, games, kills, best score) are not touched.
 */
export function LeaderboardCard({ ctx }: { ctx: ChainCtx }) {
  const [info, setInfo] = useState<LeaderboardAdminInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!ctx.api) return;
    ctx.api.leaderboards().then(
      (v) => {
        setInfo(v);
        setState('ok');
      },
      (e) => {
        if (e instanceof SiteApiError && e.status === 404) setState('missing');
        else {
          setState('error');
          setErr((e as Error).message);
        }
      },
    );
  }, [ctx.api]);
  useEffect(load, [load]);

  if (!ctx.api) return <Card title="Leaderboards" id="leaderboards" tone="quiet" lede="Sign in as the admin (top right) to see and reset the leaderboards." />;
  if (state === 'missing') return <Card title="Leaderboards" id="leaderboards" tone="quiet" lede="This server has no leaderboard reset yet (/api/admin/leaderboards). Update the game server." />;
  if (!info) return <Card title="Leaderboards" id="leaderboards" tone="quiet" lede={state === 'error' ? `Cannot load the leaderboards: ${err}` : 'Loading the leaderboards…'} />;

  const reset = async () => {
    if (!window.confirm(`Clear the Today (${info.daily}) and All-time (${info.allTime}) leaderboards now? Profiles, XP and levels stay.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await ctx.api!.resetLeaderboards();
      setInfo(r.info);
      setMsg(`Cleared ${r.cleared.daily} daily and ${r.cleared.allTime} all-time records${r.backedUp ? ' (the old file is backed up on the server)' : ''}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const last =
    info.resetAt === null ? 'never reset' : `last reset ${when(info.resetAt)}${info.resetBy === 'epoch' ? ' (automatically, by a deploy)' : info.resetBy ? ` by ${info.resetBy.slice(0, 6)}…${info.resetBy.slice(-4)}` : ''}`;
  return (
    <Card
      title="Leaderboards"
      id="leaderboards"
      kicker={`${info.daily} today · ${info.allTime} all time`}
      lede="The Today and All-time boards in the lobby (best score per player, kept by this server). A reset clears both; profiles, XP, levels and the profile stats stay as they are."
    >
      <p className="ad-role">{last} · epoch {info.epoch}</p>
      <div className="ad-inlineform">
        <Btn danger disabled={busy} onClick={() => void reset()} testId="leaderboards-reset">
          Reset both leaderboards
        </Btn>
      </div>
      {msg && (
        <p className="ad-ok" role="status">
          {msg}
        </p>
      )}
      {err && (
        <p className="ad-bad" role="alert">
          {err}
        </p>
      )}
    </Card>
  );
}
