import type { SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string | null;
  options: SelectOption[];
  placeholder?: string;
}

// Native <select>: keyboard, mobile pickers and screen readers for free.
export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  name,
  className = '',
  ...props
}: SelectProps) {
  const fieldId = id ?? name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-gray-900">
          {label}
        </label>
      )}
      <select
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`block w-full rounded-md border-0 py-2 pl-3 pr-8 text-sm text-gray-900 shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset disabled:cursor-not-allowed disabled:bg-gray-50 ${
          error ? 'ring-red-400 focus:ring-red-600' : 'ring-gray-300 focus:ring-primary-600'
        }`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}
