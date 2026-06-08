import { ChevronDown } from "../../icons/index.js";

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange?(value: string): void;
  disabled?: boolean;
  ariaLabel?: string;
};

export function Select({ value, options, onChange, disabled, ariaLabel }: SelectProps) {
  return (
    <span className="select">
      <select
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="select__chevron">
        <ChevronDown />
      </span>
    </span>
  );
}
