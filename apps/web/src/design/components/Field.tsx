import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: ReactNode;
  /** Helper line under the input. */
  hint?: ReactNode;
  /** Error message; marks the field invalid and replaces the hint. */
  error?: ReactNode;
  /** Mono text inside the box, before / after the value (e.g. "$ELYMUM"). */
  prefix?: ReactNode;
  suffix?: ReactNode;
}

/** A form box on a ticket: mono caption, bold value, pink offset on focus. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, prefix, suffix, id, className, ...input },
  ref,
) {
  const auto = useId();
  const inputId = id ?? `f${auto}`;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;
  return (
    <div className={`kb-field${error ? ' is-error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="kb-field__label mono" htmlFor={inputId}>
        {label}
      </label>
      <div className="kb-field__box">
        {prefix != null && <span className="kb-field__affix mono">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className="kb-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={note != null ? noteId : undefined}
          {...input}
        />
        {suffix != null && <span className="kb-field__affix mono">{suffix}</span>}
      </div>
      {note != null && (
        <div id={noteId} className="kb-field__note" role={error ? 'alert' : undefined}>
          {note}
        </div>
      )}
    </div>
  );
});
