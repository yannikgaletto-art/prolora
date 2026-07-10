import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

// No useId(): that hook would force every consumer into a Client Component.
// The id falls back to the field name, which forms already require.

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: ReactNode;
}

const FIELD_CLASSES =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-inset disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

function ringClasses(hasError: boolean): string {
  return hasError
    ? 'ring-red-400 focus:ring-red-600'
    : 'ring-gray-300 focus:ring-primary-600';
}

export function Input({ label, error, hint, id, name, className = '', ...props }: InputProps) {
  const fieldId = id ?? name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-gray-900">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && fieldId ? `${fieldId}-error` : undefined}
        className={`${FIELD_CLASSES} ${ringClasses(Boolean(error))}`}
        {...props}
      />
      {error ? (
        <p id={fieldId ? `${fieldId}-error` : undefined} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-sm text-gray-500">{hint}</p>
      )}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
  hint?: ReactNode;
}

export function Textarea({
  label,
  error,
  hint,
  id,
  name,
  className = '',
  ...props
}: TextareaProps) {
  const fieldId = id ?? name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-gray-900">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`${FIELD_CLASSES} ${ringClasses(Boolean(error))}`}
        {...props}
      />
      {error ? (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-sm text-gray-500">{hint}</p>
      )}
    </div>
  );
}
