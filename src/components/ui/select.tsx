import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Où vit l'étiquette par rapport au contrôle. `block` (défaut) = au-dessus,
 *  une ligne pour l'étiquette et une pour le contrôle. `inline` = à gauche, sur
 *  la MÊME ligne — la colonne du dock est haute et étroite, une étiquette
 *  au-dessus y coûte une ligne de liste (ADR-0001 : la hauteur de l'en-tête est
 *  un critère). `hidden` = étiquette rendue en `sr-only` : elle NOMME toujours
 *  le contrôle pour les lecteurs d'écran (Base UI l'associe au trigger), elle
 *  n'est simplement plus peinte. Jamais de placeholder en guise de nom. */
export type ControlLabelPlacement = "block" | "inline" | "hidden";

export interface SelectProps {
  label: string;
  value: string | null;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
  labelPlacement?: ControlLabelPlacement;
  /** APERÇU AU SURVOL (opt-in, ticket 01 retour-usage). Survoler une option
   *  appelle `onOptionPreview(value)` ; quitter le popup ou le fermer appelle
   *  `onOptionPreviewEnd()`. Le consommateur s'en sert pour montrer un aperçu
   *  non engagé (ex. recomposer le calque dans le mode survolé), et revenir à
   *  la valeur réelle à la fin. Absents = comportement inchangé (aucun autre
   *  appelant ne les passe). */
  onOptionPreview?: (value: string) => void;
  onOptionPreviewEnd?: () => void;
}

export function Select({ label, value, placeholder = "Sélectionner…", options, disabled = false, onChange, className, labelPlacement = "block", onOptionPreview, onOptionPreviewEnd }: SelectProps) {
  const inline = labelPlacement === "inline";
  return (
    <div className={cn(inline ? "flex items-center gap-2" : "flex flex-col gap-1", className)}>
      <SelectPrimitive.Root
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(nextValue) => {
          // Base UI signale null (désélection) — ce select n'expose que des
          // valeurs string à ses consommateurs.
          if (nextValue !== null) onChange(nextValue);
        }}
        onOpenChange={(open) => {
          // Fermeture du popup (sélection, Échap, clic dehors) = fin d'aperçu.
          // Sur une sélection, `onValueChange` a déjà engagé la valeur AVANT
          // cette fermeture, donc la fin d'aperçu doit revenir à la valeur
          // ENGAGÉE, pas à une valeur mémorisée périmée — c'est au consommateur
          // de le gérer (voir `handleBlendModePreviewEnd`).
          if (!open) onOptionPreviewEnd?.();
        }}
      >
        <SelectPrimitive.Label className={cn("text-sm text-muted-foreground", labelPlacement === "hidden" ? "sr-only" : inline && "shrink-0")}>{label}</SelectPrimitive.Label>
        <SelectPrimitive.Trigger className={cn(
          "flex h-[var(--control-height-md)] items-center justify-between gap-1.5 rounded-[var(--radius-control)] bg-secondary px-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent data-popup-open:bg-accent focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-solid focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]",
          // Étiquette à gauche : le trigger prend la place restante de la
          // ligne. `min-w-0` est indispensable — sans lui, un libellé long
          // (« Aberration chromatique ») pousserait la ligne au-delà de la
          // colonne au lieu d'être tronqué (le défaut `min-width: auto` d'un
          // élément flex a déjà frappé sur la rangée des presets).
          inline ? "min-w-0 flex-1" : "w-full",
        )}>
          <SelectPrimitive.Value className="truncate data-placeholder:text-[var(--text-tertiary)]" placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="icon-sm icon-stroke shrink-0 text-muted-foreground" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            align="start"
            alignItemWithTrigger={false}
            side="bottom"
            sideOffset={4}
            className="z-[var(--z-popover)]"
          >
            <SelectPrimitive.Popup
              className="max-h-[var(--select-listbox-max-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-[var(--radius-group)] bg-popover p-1 shadow-[var(--shadow-popover)] outline-none"
              // Quitter le popup entier = fin d'aperçu. Passer d'une option à
              // l'autre ne le déclenche pas (onMouseLeave ne monte qu'au bord
              // du popup, pas entre items), donc pas de fin parasite au survol.
              onMouseLeave={onOptionPreviewEnd ? () => onOptionPreviewEnd() : undefined}
            >
              <SelectPrimitive.List>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="flex h-[var(--control-height-sm)] cursor-pointer items-center justify-between gap-1.5 rounded-[var(--radius-control)] px-1.5 text-sm text-foreground outline-none data-highlighted:bg-muted data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]"
                    // Survoler une option non désactivée = aperçu de cette valeur.
                    onMouseEnter={onOptionPreview && !option.disabled ? () => onOptionPreview(option.value) : undefined}
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
