import { useId, type ComponentProps } from 'react';
import { cn } from '../cn';

export interface InputProps extends ComponentProps<'input'> {
  label: string;
  hint?: string;
  error?: string;
}

/** Labelled text field. The error is announced and linked with aria-describedby. */
export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-11 rounded-control border border-border bg-surface px-3.5 text-base text-ink placeholder:text-muted',
          error && 'border-danger',
          className,
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
