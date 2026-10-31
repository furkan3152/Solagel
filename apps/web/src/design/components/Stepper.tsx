import type { HTMLAttributes, ReactNode } from 'react';
import { Stamp } from './Stamp';

export type StepState = 'done' | 'active' | 'locked';

export interface StepItem {
  id: string;
  title: ReactNode;
  /** Mono line above the title, e.g. "Chore 2 · X · about 20 seconds". */
  meta?: ReactNode;
  /** One or two sentences. */
  body?: ReactNode;
  state: StepState;
  /** The step's action (a Button); hidden once done (a DONE stamp takes its place). */
  action?: ReactNode;
  /** Picture on the left (a CoinCharacter about 76 px). */
  art?: ReactNode;
  /** Stamp text when done (default "DONE"). */
  doneLabel?: string;
}

export interface StepperProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  steps: StepItem[];
  /** Accessible name of the list (e.g. "Whitelist chores"). */
  label: string;
  /** Show the "1 of 3 done" progress bar above the steps (default true). */
  progress?: boolean;
  /** Text after the bar; default "{done} of {total} done". */
  progressText?: (done: number, total: number) => ReactNode;
  /** Play the DONE stamp-in on the most recently completed step (remount with a key to replay). */
  stampIn?: string;
}

/**
 * The WL "ascent": each step is a terrace sticker set a little further along
 * the ring (staggered margins on wide screens, straight on phones). Done steps
 * get a green tint and a DONE rubber stamp; locked steps a dashed, sanded look.
 */
export function Stepper({ steps, label, progress = true, progressText, stampIn, className, ...rest }: StepperProps) {
  const done = steps.filter((s) => s.state === 'done').length;
  const total = steps.length;
  return (
    <div {...rest} className={`kb-stepper${className ? ` ${className}` : ''}`}>
      {progress && (
        <div className="kb-stepper__prog">
          <span className="kb-stepper__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </span>
          <span className="kb-stepper__count">{progressText ? progressText(done, total) : `${done} of ${total} done`}</span>
        </div>
      )}
      <ol className="kb-stepper__list" aria-label={label} style={{ ['--steps' as string]: total }}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`kb-step kb-step--${s.state}`}
            style={{ ['--terrace' as string]: i }}
            aria-current={s.state === 'active' ? 'step' : undefined}
          >
            {s.art != null && (
              <span className="kb-step__art" aria-hidden="true">
                {s.art}
              </span>
            )}
            <div className="kb-step__text">
              {s.meta != null && <div className="kb-step__meta">{s.meta}</div>}
              <h3 className="kb-step__title">{s.title}</h3>
              {s.body != null && <p className="kb-step__body">{s.body}</p>}
            </div>
            <div className="kb-step__act">
              {s.state === 'done' ? (
                <Stamp text={s.doneLabel ?? 'DONE'} tone="up" rotate={-7} animateIn={stampIn === s.id} />
              ) : (
                s.action
              )}
            </div>
            <span className="kb-sr">{s.state === 'done' ? '(done)' : s.state === 'locked' ? '(locked)' : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
