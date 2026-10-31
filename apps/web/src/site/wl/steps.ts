import { SITE_LIMITS, WL_TASK_X_HANDLE, isXStatusUrl, normalizeXHandle, type PublicWlTask, type WlSubmitRequest } from '@elymum/shared';

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
      title: handleTask?.title || 'Your X handle',
      body: handleTask?.body || 'Your ticket card, its number and its coin are made from your handle.',
      required: true,
      task: handleTask,
    },
    ...middle.map((t) => ({ key: t.id, kind: t.kind, title: t.title, body: t.body, required: t.required && t.available, task: t })),
    {
      key: 'wallet',
      kind: 'sign',
      title: walletTask?.title || 'Your EVM wallet',
      body: walletTask?.body || 'Sign in with the wallet that should go on the list. It is free and sends no transaction.',
      required: true,
      task: walletTask,
    },
  ];
}

export type Answers = Record<string, string | boolean | undefined>;

export const X_LINK_HINT = 'It looks like https://x.com/yourname/status/1234567890.';

/** The inline error of a step, or null when it may move on. The same rules as the server. */
export function stepError(step: Step, answers: Answers, handle: string, signedIn: boolean): string | null {
  switch (step.kind) {
    case 'handle':
      if (!handle.trim()) return 'Enter your X handle.';
      return normalizeXHandle(handle) ? null : 'That is not an X handle. Use 1 to 15 letters, numbers or underscores, like @elymum.';
    case 'sign':
      return signedIn ? null : 'Sign in with your wallet to finish.';
    case 'follow_x':
    case 'join_link':
      if (!step.required) return null;
      return answers[step.key] === true ? null : step.kind === 'follow_x' ? 'Tick this once you follow.' : 'Tick this once you have joined.';
    case 'post_x':
    case 'engage_x': {
      if (step.kind === 'engage_x' && !step.task.available) return null;
      const v = String(answers[step.key] ?? '').trim();
      if (!v) return step.required ? (step.kind === 'post_x' ? 'Paste the link to your post.' : 'Paste the link to your reply.') : null;
      return isXStatusUrl(v) ? null : `That is not a link to an X post. ${X_LINK_HINT}`;
    }
    case 'text': {
      const v = String(answers[step.key] ?? '').trim();
      if (!v) return step.required ? 'Answer this to continue.' : null;
      return v.length > SITE_LIMITS.textAnswer ? `Keep it under ${SITE_LIMITS.textAnswer} characters.` : null;
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
