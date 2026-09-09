import { useMemo, useState } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Plus, Search } from "lucide-react";
import { buildEffectCatalog } from "../render/effects/catalog";
import { effectRegistry } from "../render/effects/registry";
import type { EffectThumbnailPicker } from "../hooks/useEffectThumbnails";
import "./EffectPicker.css";

interface Props {
  disabled?: boolean;
  onSelect: (effectId: string) => void;
  /** APERÇU AU SURVOL (ticket 05), OPT-IN — même contrat que
   *  `onOptionPreview`/`onOptionPreviewEnd` du select des modes de fusion :
   *  absent, le popup est exactement celui d'avant, sans zone d'aperçu ni
   *  colonne supplémentaire. C'est ce qui laisse les stories et tout appelant
   *  sans GPU monter ce composant tel quel. */
  preview?: EffectThumbnailPicker;
  /** OUVERTURE CONTRÔLÉE (ticket 28) : l'entrée « Ajouter un effet… » du menu
   *  contextuel du vide de la pile ouvre CE sélecteur sans que l'utilisateur
   *  ait à viser son bouton. OPT-IN — absent, le popover garde son état interne
   *  (déclenché par son propre bouton), donc les stories et tout appelant qui
   *  ne pilote pas l'ouverture montent le composant tel quel. Base UI traite
   *  `open={undefined}` comme un popover non contrôlé. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Effet SOUS LE CURSEUR — état purement présentationnel, il ne quitte jamais
 *  ce composant. Il porte le nom en plus de l'id pour que la légende reste
 *  juste quand la recherche filtre la liste sous le curseur. */
interface HoveredEffect {
  id: string;
  name: string;
}

export function EffectPicker({ disabled = false, onSelect, preview, open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<HoveredEffect | null>(null);
  const groups = useMemo(() => buildEffectCatalog(effectRegistry, query), [query]);

  const beginPreview = (effect: HoveredEffect) => {
    setHovered(effect);
    preview?.onPreview(effect.id);
  };

  // Quitter le POPUP ENTIER, jamais un item : passer d'un effet à l'autre ne
  // déclenche pas `mouseleave` au niveau du popup, donc pas de fin d'aperçu
  // parasite au balayage (même raison qu'en `ui/select.tsx`).
  const endPreview = () => {
    setHovered(null);
    preview?.onPreviewEnd();
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setHovered(null);
        }
        preview?.onOpenChange(next);
        onOpenChange?.(next);
      }}
    >
      <PopoverPrimitive.Trigger
        disabled={disabled}
        className="flex h-[var(--control-height-md)] w-full items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-secondary px-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-solid focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]"
      >
        <Plus className="icon-sm icon-stroke" aria-hidden="true" />
        Ajouter un effet
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align="start" sideOffset={4} className="z-[var(--z-popover)]">
          <PopoverPrimitive.Popup
            className="effect-picker__popup flex max-h-[var(--select-listbox-max-height)] min-w-[var(--anchor-width)] flex-col overflow-hidden rounded-[var(--radius-group)] bg-popover p-1 shadow-[var(--shadow-popover)] outline-none"
            onMouseLeave={preview ? endPreview : undefined}
          >
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
            <div className="effect-picker__body">
              <div className="scroll-thin effect-picker__list" role="listbox" aria-label="Effets">
                {groups.map((group) => (
                  <section key={group.category} aria-label={group.category} className="effect-picker__group">
                    <div className="effect-picker__category">{group.category}</div>
                    {group.effects.map((effect) => (
                      <PopoverPrimitive.Close
                        key={effect.id}
                        role="option"
                        className="effect-picker__effect flex h-[var(--control-height-sm)] w-full cursor-pointer items-center rounded-[var(--radius-control)] text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                        onClick={() => onSelect(effect.id)}
                        onMouseEnter={preview ? () => beginPreview({ id: effect.id, name: effect.name }) : undefined}
                        // Parité CLAVIER : les options se parcourent aussi à la
                        // flèche, et un aperçu qui n'existe qu'à la souris
                        // laisserait ce parcours-là sans image.
                        onFocus={preview ? () => beginPreview({ id: effect.id, name: effect.name }) : undefined}
                      >
                        {effect.name}
                      </PopoverPrimitive.Close>
                    ))}
                  </section>
                ))}
                {groups.length === 0 && <p className="m-0 px-2 py-3 text-sm text-muted-foreground">Aucun effet trouvé.</p>}
              </div>
              {preview && <PreviewPane hovered={hovered} url={hovered !== null && preview.preview?.effectId === hovered.id ? preview.preview.url : null} />}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Zone d'aperçu. Trois états, et le second n'est pas un échec : rien de
 *  survolé (invitation), survolé sans image encore (la place est TENUE, sinon
 *  la liste sauterait à chaque survol), survolé avec image. */
function PreviewPane({ hovered, url }: { hovered: HoveredEffect | null; url: string | null }) {
  return (
    <aside className="effect-picker__preview">
      <div className="effect-picker__preview-frame">
        {url !== null && hovered !== null ? (
          <img className="effect-picker__preview-image" src={url} alt={`Aperçu de l'effet ${hovered.name}`} />
        ) : (
          <span className="effect-picker__preview-placeholder">
            {hovered === null ? "Survolez un effet" : "Aperçu…"}
          </span>
        )}
      </div>
      <p className="effect-picker__preview-caption">{hovered?.name ?? "Aperçu"}</p>
    </aside>
  );
}
