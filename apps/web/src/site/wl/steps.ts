import { SITE_LIMITS, WL_TASK_X_HANDLE, isXStatusUrl, normalizeXHandle, type PublicWlTask, type WlSubmitRequest } from '@elymum/shared';
import { t } from '../../i18n';

/**
 * The WL stepper, built from the server's task list. Two steps are structural and pinned:
 * the X handle comes first (the ticket card is made from it, and it is the entry's uniqueness
 * key), and the wallet sign-in comes last (the entry's wallet is the signed-in one). The other
 * tasks keep the admin's order.
 */
export type Step =
  | { key: 'handle'; kind: 'handle'; title: string; body: string; required: true; task: PublicWlTask | null }
  | { key: string; kind: PublicWlTask['kind']; title: string; body: string; required: boolean; task: PublicWlTask }
  | { key: 'wallet'; kind: 'sign'; title: string; body: string; required: true; task: PublicWlTask | null };

export function buildSteps(tasks: readonly PublicWlTask[]): Step[] {
  const handleTask = tasks.find((t) => t.id === WL_TASK_X_HANDLE) ?? null;
  const walletTask = tasks.find((t) => t.kind === 'wallet') ?? null;
  const middle = tasks.filter((t) => t.id !== WL_TASK_X_HANDLE && t.kind !== 'wallet');
  return [
    {
      key: 'handle',
      kind: 'handle',
      title: handleTask?.title || t('wp.handle.title'),
      body: handleTask?.body || t('wp.handle.body'),
      required: true,
      task: handleTask,
    },
    ...middle.map((t) => ({ key: t.id, kind: t.kind, title: t.title, body: t.body, required: t.required && t.available, task: t })),
    {
      key: 'wallet',
      kind: 'sign',
      title: walletTask?.title || t('wp.wallet.title'),
      body: walletTask?.body || t('wp.wallet.body'),
      required: true,
      task: walletTask,
    },
  ];
}

export type Answers = Record<string, string | boolean | undefined>;

export const xLinkHint = () => t('wp.err.linkHint');

/** The inline error of a step, or null when it may move on. The same rules as the server. */
export function stepError(step: Step, answers: Answers, handle: string, signedIn: boolean): string | null {
  switch (step.kind) {
    case 'handle':
      if (!handle.trim()) return t('wp.err.handleEmpty');
      return normalizeXHandle(handle) ? null : t('wp.err.handleBad');
    case 'sign':
      return signedIn ? null : t('wp.err.sign');
    case 'follow_x':
    case 'join_link':
      if (!step.required) return null;
      return answers[step.key] === true ? null : step.kind === 'follow_x' ? t('wp.err.follow') : t('wp.err.join');
    case 'post_x':
    case 'engage_x': {
      if (step.kind === 'engage_x' && !step.task.available) return null;
      const v = String(answers[step.key] ?? '').trim();
      if (!v) return step.required ? (step.kind === 'post_x' ? t('wp.err.post') : t('wp.err.reply')) : null;
      return isXStatusUrl(v) ? null : t('wp.err.notPost', { hint: xLinkHint() });
    }
    case 'text': {
      const v = String(answers[step.key] ?? '').trim();
      if (!v) return step.required ? t('wp.err.answer') : null;
      return v.length > SITE_LIMITS.textAnswer ? t('wp.err.long', { n: SITE_LIMITS.textAnswer }) : null;
    }
    default:
      return null;
  }
}

/** The `POST /api/site/wl` body for the answers given. */
export function submitBody(steps: readonly Step[], answers: Answers, handle: string, website: string): WlSubmitRequest {
  const out: Record<string, string | boolean> = {};
  for (const s of steps) {
    if (s.kind === 'handle' || s.kind === 'sign') continue;
    if (!s.task.available) continue;
    const v = answers[s.key];
    if (s.kind === 'follow_x' || s.kind === 'join_link') {
      if (v === true) out[s.key] = true;
    } else if (typeof v === 'string' && v.trim()) {
      out[s.key] = v.trim();
    }
  }
  const body: WlSubmitRequest = { xHandle: normalizeXHandle(handle) ?? handle.trim(), answers: out };
  if (website) body.website = website;
  return body;
}

/** The step a server error points at (`xHandle`, `answers.<id>`), as an index. */
export function stepForField(steps: readonly Step[], field: string | undefined): number {
  if (!field) return -1;
  if (field === 'xHandle' || field === `answers.${WL_TASK_X_HANDLE}`) return steps.findIndex((s) => s.kind === 'handle');
  const id = field.startsWith('answers.') ? field.slice('answers.'.length) : field;
  return steps.findIndex((s) => s.key === id);
}

/** The tweet id of an X status link (for the like / repost / reply intents). */
export const tweetId = (url: string | null): string | null => (url ? (/\/status\/(\d+)/.exec(url)?.[1] ?? null) : null);
