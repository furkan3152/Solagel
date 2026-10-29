import { SITE_LIMITS, WL_TASK_KINDS, isXStatusUrl, type WlTask, type WlTaskKind } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { Chip, Field, InkButton, StampSpinner } from '../../design';
import type { TaskInput } from '../../site/api';
import { Ext, errText, useFlash, type TabProps } from './common';

export const KIND_LABEL: Record<WlTaskKind, string> = {
  follow_x: 'Follow on X',
  post_x: 'Post on X (link)',
  engage_x: 'Like / repost / reply (link)',
  join_link: 'Join a link (self-attested)',
  text: 'Free answer',
  wallet: 'EVM wallet (signed in)',
};

const NEEDS_TARGET: WlTaskKind[] = ['follow_x', 'engage_x', 'join_link'];

interface Draft {
  kind: WlTaskKind;
  title: string;
  body: string;
  target: string;
  required: boolean;
  enabled: boolean;
}
const EMPTY: Draft = { kind: 'follow_x', title: '', body: '', target: '', required: true, enabled: true };

function draftErrors(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (!d.title.trim()) e.title = 'A title is required.';
  else if (d.title.trim().length > SITE_LIMITS.taskTitle) e.title = `At most ${SITE_LIMITS.taskTitle} characters.`;
  if (d.body.trim().length > SITE_LIMITS.taskBody) e.body = `At most ${SITE_LIMITS.taskBody} characters.`;
  const t = d.target.trim();
  if (t) {
    if (t.length > SITE_LIMITS.taskTarget) e.target = `At most ${SITE_LIMITS.taskTarget} characters.`;
    else if (!/^https:\/\//.test(t) && !(d.kind === 'follow_x' && /^@?[A-Za-z0-9_]{1,15}$/.test(t))) e.target = d.kind === 'follow_x' ? 'An https:// link or an X handle.' : 'An https:// link.';
  }
  return e;
}

function TaskForm({ initial, submitLabel, onSubmit, onCancel }: { initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel?: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [errs, setErrs] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const e = draftErrors(d);
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await onSubmit(d);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ad-form ad-taskform">
      <div className="ad-row">
        <div>
          <label className="mono ad-cap" htmlFor={`kind-${submitLabel}`}>
            Kind
          </label>
          <select id={`kind-${submitLabel}`} className="st-input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as WlTaskKind })}>
            {WL_TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <Field label="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} error={errs.title} maxLength={SITE_LIMITS.taskTitle + 10} />
      </div>
      <div>
        <label className="mono ad-cap" htmlFor={`body-${submitLabel}`}>
          Body
        </label>
        <textarea id={`body-${submitLabel}`} className="st-input" value={d.body} rows={3} onChange={(e) => setD({ ...d, body: e.target.value })} />
        {errs.body && <p className="ad-bad">{errs.body}</p>}
      </div>
      <Field
        label="Target"
        value={d.target}
        onChange={(e) => setD({ ...d, target: e.target.value })}
        error={errs.target}
        hint={d.kind === 'engage_x' ? 'Leave empty to use the launch post below.' : NEEDS_TARGET.includes(d.kind) ? 'The link (or, to follow, the handle) the task points at.' : 'Optional.'}
      />
      <div className="ad-chips">
        <label className="ad-check">
          <input type="checkbox" checked={d.required} onChange={(e) => setD({ ...d, required: e.target.checked })} /> Required
        </label>
        <label className="ad-check">
          <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /> Enabled
        </label>
      </div>
      <div className="ad-actions">
        <InkButton variant="teal" size="sm" onClick={() => void go()} disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </InkButton>
        {onCancel && (
          <InkButton variant="paper" size="sm" onClick={onCancel}>
            Cancel
          </InkButton>
        )}
      </div>
    </div>
  );
}

const toInput = (d: Draft): TaskInput => ({ kind: d.kind, title: d.title.trim(), body: d.body.trim(), target: d.target.trim() || null, required: d.required, enabled: d.enabled });

/** WL tasks: add, edit, reorder, enable or disable, delete; and the launch post link. */
export function TasksTab({ api }: TabProps) {
  const [tasks, setTasks] = useState<WlTask[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [launch, setLaunch] = useState('');
  const [launchSaved, setLaunchSaved] = useState<string | null>(null);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [flashNode, flash] = useFlash();

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.tasks(), api.settings()]);
      setTasks(t);
      setLaunch(s.settings.launchPostUrl ?? '');
      setLaunchSaved(s.settings.launchPostUrl);
    } catch (e) {
      flash('err', errText(e));
    }
  }, [api, flash]);
  useEffect(() => void load(), [load]);

  if (!tasks) return <StampSpinner label="Loading" />;

  const run = async (label: string, f: () => Promise<unknown>) => {
    try {
      await f();
      flash('ok', label);
    } catch (e) {
      flash('err', errText(e));
    }
  };

  const move = (i: number, dir: -1 | 1) =>
    run('Order saved.', async () => {
      const ids = tasks.map((t) => t.id);
      const j = i + dir;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      setTasks(await api.orderTasks(ids));
    });

  const saveLaunch = async () => {
    const v = launch.trim();
    if (v && !isXStatusUrl(v)) {
      setLaunchErr('An X post link: https://x.com/<handle>/status/<id>.');
      return;
    }
    await run(v ? 'Launch post saved: the engage step is open.' : 'Launch post cleared.', async () => {
      const r = await api.saveSettings({ launchPostUrl: v || null });
      setLaunchSaved(r.settings.launchPostUrl);
      setLaunch(r.settings.launchPostUrl ?? '');
    });
  };

  return (
    <div className="ad-stack">
      <section className="ad-card" aria-labelledby="ad-launch-h">
        <h2 className="ad-card__title" id="ad-launch-h">
          Launch post
        </h2>
        <p className="ad-card__lede">The pinned post the like / repost / reply task points at. Until it is set, that step shows “opens when the post is live” and is not required.</p>
        <Field
          label="Launch post link"
          value={launch}
          onChange={(e) => {
            setLaunch(e.target.value);
            setLaunchErr(null);
          }}
          error={launchErr ?? undefined}
          placeholder="https://x.com/elymum/status/…"
        />
        <div className="ad-actions">
          <InkButton variant="pink" size="sm" onClick={() => void saveLaunch()} disabled={(launch.trim() || null) === launchSaved}>
            Save launch post
          </InkButton>
          {launchSaved && <Ext href={launchSaved}>Open the post</Ext>}
        </div>
      </section>

      <section className="ad-card" aria-labelledby="ad-tasks-h">
        <div className="ad-card__bar">
          <h2 className="ad-card__title" id="ad-tasks-h">
            WL tasks ({tasks.length})
          </h2>
          {!adding && (
            <InkButton variant="secondary" size="sm" onClick={() => setAdding(true)} disabled={tasks.length >= SITE_LIMITS.maxTasks}>
              Add task
            </InkButton>
          )}
        </div>
        <p className="ad-card__lede">Changes apply to new applicants. Entries already sent keep the tasks as they answered them.</p>
        {adding && (
          <TaskForm
            initial={EMPTY}
            submitLabel="Create task"
            onCancel={() => setAdding(false)}
            onSubmit={(d) =>
              run('Task created.', async () => {
                const t = await api.createTask(toInput(d));
                setTasks((list) => [...(list ?? []), t]);
                setAdding(false);
              })
            }
          />
        )}
        <ol className="ad-tasks">
          {tasks.map((t, i) => (
            <li key={t.id} className={`ad-task${t.enabled ? '' : ' is-off'}`}>
              {editing === t.id ? (
                <TaskForm
                  initial={{ kind: t.kind, title: t.title, body: t.body, target: t.target ?? '', required: t.required, enabled: t.enabled }}
                  submitLabel="Save task"
                  onCancel={() => setEditing(null)}
                  onSubmit={(d) =>
                    run('Task saved.', async () => {
                      const nt = await api.updateTask(t.id, toInput(d));
                      setTasks((list) => list!.map((x) => (x.id === t.id ? nt : x)));
                      setEditing(null);
                    })
                  }
                />
              ) : (
                <>
                  <div className="ad-task__main">
                    <span className="mono ad-task__no">{i + 1}</span>
                    <div>
                      <strong>{t.title}</strong>
                      <div className="ad-chips">
                        <Chip tone="ink">{KIND_LABEL[t.kind]}</Chip>
                        {t.required ? <Chip tone="pink">Required</Chip> : <Chip tone="mustard">Optional</Chip>}
                        {!t.enabled && <Chip tone="mustard">Disabled</Chip>}
                        <code className="ad-note">{t.id}</code>
                      </div>
                      {t.body && <p className="ad-note">{t.body}</p>}
                      {t.target && (
                        <p className="ad-note">
                          Target: <Ext href={t.target} />
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="ad-actions ad-task__btns">
                    <InkButton variant="paper" size="sm" onClick={() => void move(i, -1)} disabled={i === 0} aria-label={`Move ${t.title} up`}>
                      Up
                    </InkButton>
                    <InkButton variant="paper" size="sm" onClick={() => void move(i, 1)} disabled={i === tasks.length - 1} aria-label={`Move ${t.title} down`}>
                      Down
                    </InkButton>
                    <InkButton variant="paper" size="sm" onClick={() => setEditing(t.id)}>
                      Edit
                    </InkButton>
                    <InkButton
                      variant="paper"
                      size="sm"
                      onClick={() =>
                        void run(t.enabled ? 'Task disabled.' : 'Task enabled.', async () => {
                          const nt = await api.updateTask(t.id, { enabled: !t.enabled });
                          setTasks((list) => list!.map((x) => (x.id === t.id ? nt : x)));
                        })
                      }
                    >
                      {t.enabled ? 'Disable' : 'Enable'}
                    </InkButton>
                    <InkButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (!window.confirm(`Delete the task “${t.title}”? Entries already sent keep their answers.`)) return;
                        void run('Task deleted.', async () => {
                          await api.deleteTask(t.id);
                          setTasks((list) => list!.filter((x) => x.id !== t.id));
                        });
                      }}
                    >
                      Delete
                    </InkButton>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
        {flashNode}
      </section>
    </div>
  );
}
