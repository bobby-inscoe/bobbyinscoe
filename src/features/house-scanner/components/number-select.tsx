import { Select } from '@mantine/core';

const ANY = 'any';

interface NumberSelectProps {
  // Omit it when a heading above already names a group of fields.
  label?: string;
  // The accessible name when the visible label is shorter, for example "Min" above a group heading.
  ariaLabel?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  options: readonly number[];
  format: (value: number) => string;
  // Text of the choice that clears the value. Without it the value cannot be cleared.
  anyLabel?: string;
  disabled?: boolean;
}

/** A dropdown of numbers. A saved value outside the steps stays selectable, so opening it never changes it. */
export function NumberSelect({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  format,
  anyLabel,
  disabled,
}: NumberSelectProps) {
  const steps =
    value === null || options.includes(value)
      ? [...options]
      : [...options, value].sort((a, b) => a - b);
  return (
    <Select
      label={label}
      aria-label={ariaLabel}
      value={value === null ? ANY : String(value)}
      onChange={(next) =>
        onChange(next === null || next === ANY ? null : Number(next))
      }
      data={[
        ...(anyLabel === undefined ? [] : [{ value: ANY, label: anyLabel }]),
        ...steps.map((step) => ({ value: String(step), label: format(step) })),
      ]}
      allowDeselect={false}
      comboboxProps={{ withinPortal: false }}
      disabled={disabled}
    />
  );
}
