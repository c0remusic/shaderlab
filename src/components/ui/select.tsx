import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value: string | null;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}

/** Converts Base UI's nullable change signal to this select's string-only consumer API. */
export function toSelectChange(value: string | null): string | null {
  return value;
}

export function Select({ label, value, placeholder = "Sélectionner…", options, disabled = false, onChange, className }: SelectProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <SelectPrimitive.Root
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(nextValue) => {
          const next = toSelectChange(nextValue);
          if (next !== null) onChange(next);
        }}
      >
        <SelectPrimitive.Label className="text-sm text-muted-foreground">{label}</SelectPrimitive.Label>
        <SelectPrimitive.Trigger className="flex h-[var(--control-height-md)] w-full items-center justify-between gap-1.5 rounded-[var(--radius-control)] bg-secondary px-2.5 text-base text-secondary-foreground transition-colors hover:bg-accent data-popup-open:bg-accent focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]">
          <SelectPrimitive.Value className="truncate data-placeholder:text-[var(--text-tertiary)]" placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="icon-sm icon-stroke shrink-0 text-muted-foreground" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner sideOffset={4} className="z-[var(--z-popover)]">
            <SelectPrimitive.Popup className="max-h-[var(--select-listbox-max-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-[var(--radius-group)] bg-popover p-1 shadow-[var(--shadow-popover)] outline-none">
              <SelectPrimitive.List>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="flex h-[var(--control-height-sm)] cursor-pointer items-center justify-between gap-1.5 rounded-[var(--radius-control)] px-1.5 text-base text-foreground outline-none data-highlighted:bg-muted data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator>
                      <Check className="icon-sm icon-stroke" aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
