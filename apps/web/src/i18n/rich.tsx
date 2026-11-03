import { Fragment, type ReactNode } from 'react';
import { useT, type TKey, type TVars } from '.';

/** Wrappers for the tags a string may carry: `'Read <docs>the guide</docs>.'` with `{ docs: (c) => <Link>{c}</Link> }`. */
export type RichTags = Record<string, (chunk: ReactNode) => ReactNode>;

const TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

/** Turns a translated string with flat `<tag>…</tag>` marks into React nodes. Unknown tags keep their text. */
export function renderRich(s: string, tags: RichTags): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of s.matchAll(TAG)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const wrap = tags[m[1]];
    out.push(<Fragment key={i++}>{wrap ? wrap(m[2]) : m[2]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length === 1 ? out[0] : out;
}

/** `const r = useRich(); r('ld.feast.h', { em: (c) => <em>{c}</em> })`. */
export function useRich(): (key: TKey, tags: RichTags, vars?: TVars) => ReactNode {
  const t = useT();
  return (key, tags, vars) => renderRich(t(key, vars), tags);
}

/** A component form for JSX: `<T k="ld.feast.h" tags={{ em: (c) => <em>{c}</em> }} />`. */
export function T({ k, tags = {}, vars }: { k: TKey; tags?: RichTags; vars?: TVars }) {
  const t = useT();
  return <>{renderRich(t(k, vars), tags)}</>;
}

/** Common wrappers. */
export const em = (c: ReactNode) => <em>{c}</em>;
export const strong = (c: ReactNode) => <strong>{c}</strong>;
export const b = (c: ReactNode) => <b>{c}</b>;
export const i = (c: ReactNode) => <i>{c}</i>;
