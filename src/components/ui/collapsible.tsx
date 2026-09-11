import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /**
   * Contrôle posé AU DÉBUT de la barre, HORS du déclencheur — l'interrupteur
   * (œil) de l'accordéon Lightroom (ticket 07), qui active/désactive le panneau
   * sans l'ouvrir ni le fermer. Il vit hors du `Trigger` parce que celui-ci est
   * un `<button>` : un bouton dans un bouton est invalide. Absent (défaut) = la
   * barre est le seul déclencheur, rendu EXACTEMENT comme avant l'ajout de ce
   * slot (chemin non modifié), donc tous les usages existants (repli « Effet »,
   * sections) sont inchangés au pixel.
   */
  leading?: ReactNode;
  /**
   * Côté du TITRE et du chevron. `"start"` (défaut) = chevron à gauche, titre à
   * sa suite — la forme historique. `"end"` = titre aligné à DROITE, chevron
   * tout à droite — la forme du module Développement de Lightroom.
   */
  align?: "start" | "end";
}

const triggerBaseClass =
  "flex h-[var(--section-header-height)] w-full items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-left text-2xs font-semibold tracking-[var(--tracking-label)] uppercase text-foreground transition-colors hover:bg-muted focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]";

const chevronClass =
  "icon-sm icon-stroke shrink-0 text-muted-foreground transition-transform data-panel-open:rotate-90";

export function Disclosure({ title, defaultOpen = false, open, disabled = false, onOpenChange, children, className, leading, align = "start" }: DisclosureProps) {
  // CHEMIN HISTORIQUE, byte-identique : aucun slot `leading`, titre à gauche.
  if (leading === undefined && align === "start") {
    return (
      <CollapsiblePrimitive.Root defaultOpen={defaultOpen} open={open} disabled={disabled} onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} className={className}>
        <CollapsiblePrimitive.Trigger className={triggerBaseClass}>
          <ChevronRight className={chevronClass} aria-hidden="true" />
          <span>{title}</span>
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Panel className="px-1.5 py-2">{children}</CollapsiblePrimitive.Panel>
      </CollapsiblePrimitive.Root>
    );
  }
  // FORME LIGHTROOM : œil (leading) à gauche, titre à droite, chevron tout à
  // droite. Le `Trigger` reste imbriqué dans la barre — Base UI le résout par
  // contexte, sa profondeur dans l'arbre est indifférente.
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} open={open} disabled={disabled} onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} className={className}>
      <div className="flex h-[var(--section-header-height)] w-full items-center gap-1.5">
        {leading}
        <CollapsiblePrimitive.Trigger className={triggerBaseClass}>
          {align === "start" && <ChevronRight className={chevronClass} aria-hidden="true" />}
          <span className={align === "end" ? "min-w-0 flex-1 truncate text-right" : "min-w-0 flex-1 truncate"}>{title}</span>
          {align === "end" && <ChevronRight className={chevronClass} aria-hidden="true" />}
        </CollapsiblePrimitive.Trigger>
      </div>
      <CollapsiblePrimitive.Panel className="px-1.5 py-2">{children}</CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
