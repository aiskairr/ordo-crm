"use client";

import { useState, type ComponentPropsWithoutRef, type FocusEvent } from "react";

type ClearableNumberInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
  emptyValue?: number;
};

export function ClearableNumberInput({
  value,
  onValueChange,
  emptyValue = 0,
  onFocus,
  onBlur,
  readOnly,
  ...inputProps
}: ClearableNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? (Number.isFinite(value) ? String(value) : "");

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (!readOnly) setDraft(value === 0 ? "" : String(value));
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const parsed = Number(event.currentTarget.value);
    if (!event.currentTarget.value.trim() || !Number.isFinite(parsed)) onValueChange(emptyValue);
    setDraft(null);
    onBlur?.(event);
  };

  return (
    <input
      {...inputProps}
      type="number"
      value={displayedValue}
      readOnly={readOnly}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(event) => {
        const rawValue = event.currentTarget.value;
        setDraft(rawValue);
        if (!rawValue.trim()) return;
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) onValueChange(parsed);
      }}
    />
  );
}
