import { useMemo, useState } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Plus, Search } from "lucide-react";
import { buildEffectCatalog } from "../render/effects/catalog";
import { effectRegistry } from "../render/effects/registry";
import "./EffectPicker.css";

interface Props {
  disabled?: boolean;
  onSelect: (effectId: string) => void;
}

export function EffectPicker({ disabled = false, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => buildEffectCatalog(effectRegistry, query), [query]);

  return (
    <PopoverPrimitive.Root onOpenChange={(open) => { if (!open) setQuery(""); }}>
      <PopoverPrimitive.Trigger
        disabled={disabled}
        className="flex h-[var(--control-height-md)] w-full items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-secondary px-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-solid focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]"
      >
        <Plus className="icon-sm icon-stroke" aria-hidden="true" />
        Ajouter un effet
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align="start" sideOffset={4} className="z-[var(--z-popover)]">
          <PopoverPrimitive.Popup className="flex max-h-[var(--select-listbox-max-height)] min-w-[var(--anchor-width)] flex-col overflow-hidden rounded-[var(--radius-group)] bg-popover p-1 shadow-[var(--shadow-popover)] outline-none">
            <label className="effect-picker__search flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-inset)] px-2.5 text-muted-foreground">
              <Search className="icon-sm icon-stroke shrink-0" aria-hidden="true" />
              <span className="sr-only">Rechercher un effet</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Rechercher…"
                className="effect-picker__search-input min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-[var(--text-tertiary)]"
              />
            </label>
            <div className="scroll-thin mt-1 overflow-y-auto" role="listbox" aria-label="Effets">
              {groups.map((group) => (
                <section key={group.category} aria-label={group.category} className="effect-picker__group">
                  <div className="effect-picker__category">{group.category}</div>
                  {group.effects.map((effect) => (
                    <PopoverPrimitive.Close
                      key={effect.id}
                      role="option"
                      className="effect-picker__effect flex h-[var(--control-height-sm)] w-full cursor-pointer items-center rounded-[var(--radius-control)] text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                      onClick={() => onSelect(effect.id)}
                    >
                      {effect.name}
                    </PopoverPrimitive.Close>
                  ))}
                </section>
              ))}
              {groups.length === 0 && <p className="m-0 px-2 py-3 text-sm text-muted-foreground">Aucun effet trouvé.</p>}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
