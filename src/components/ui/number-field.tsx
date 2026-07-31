import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { ControlLabelPlacement } from "./select";
import { cn } from "../../lib/utils";
import { parseControlValue } from "../../ui/formatValue";

/** Classes des cinq boîtes du champ. Chacune ÉCRASE le style par défaut (elle
 *  ne s'y ajoute pas) : un appelant qui a déjà sa feuille de style — PhotoPanel
 *  et ses `.photo-panel__*` — garde exactement son rendu d'avant l'extraction,
 *  sans hériter d'un utilitaire Tailwind qui entrerait en concurrence avec ses
 *  propres règles. */
export interface NumberFieldClassNames {
  root?: string;
  label?: string;
  field?: string;
  input?: string;
  unit?: string;
}

export interface NumberFieldProps {
  label: string;
  /** Valeur affichée, DÉJÀ dans l'unité du champ (px, %, °). */
  value: number;
  unit?: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  /** Reçoit la valeur DANS L'UNITÉ DU CHAMP, déjà bornée et arrondie au pas. */
  onCommit: (value: number) => void;
  /** Analyse de la saisie. Défaut : `parseControlValue(raw, min, max, step)`.
   *  Un champ dont le contrat de saisie est propre à son domaine passe SA
   *  fonction pure (testée chez lui) plutôt que de le réécrire ici. */
  parse?: (raw: string) => number | null;
  /** Voir `ControlLabelPlacement` (./select). `hidden` garde le nom accessible
   *  (l'étiquette reste dans le DOM en `sr-only`, liée par `htmlFor`). */
  labelPlacement?: ControlLabelPlacement;
  classNames?: NumberFieldClassNames;
}

/** Style par défaut du champ, aligné sur celui du champ de valeur de
 *  `LabeledSlider` : même hauteur de contrôle, même fonte tabulaire, mêmes
 *  états focus/hover. Deux champs numériques du dock qui divergeraient
 *  visuellement seraient une dérive de cohérence, pas un choix. */
const DEFAULT_INPUT_CLASS =
  "min-w-0 flex-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border bg-[var(--surface-inset)] px-2 text-right font-mono text-sm tabular-nums text-foreground outline-none transition-colors hover:border-[var(--border-emphasis)] focus-visible:border-[var(--focus-color)] focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]/50 disabled:cursor-not-allowed";

/**
 * Champ numérique à brouillon local — extrait de `PhotoPanel` le 2026-07-28,
 * qui en portait la seule implémentation (X / Y / échelle / angle).
 *
 * Contrat de commit, identique à celui du champ de valeur de `LabeledSlider` :
 * brouillon local pendant l'édition, commit au `blur`, `Entrée` qui ne fait que
 * blurrer (jamais un second commit — la prop contrôlée n'est pas rafraîchie
 * entre les deux, donc aucune garde ne pourrait dédupliquer), `Échap` qui
 * abandonne. Une saisie invalide revient à la valeur précédente ; jamais un
 * `NaN` appliqué au modèle.
 *
 * Contrairement à une PISTE, un champ ne perd aucune précision quand il
 * rétrécit : c'est ce qui lui vaut la place du curseur d'opacité dans l'en-tête
 * compact (Photoshop web y met lui aussi un champ, pas une piste — voir
 * `docs/design-system/photoshop-web-observations-2026-07-27.md` §2).
 */
export function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step,
  disabled = false,
  onCommit,
  parse,
  labelPlacement = "block",
  classNames,
}: NumberFieldProps) {
  const id = useId();
  const shown = String(value);
  const [draft, setDraft] = useState(shown);
  const [isEditing, setIsEditing] = useState(false);
  // `Échap` doit annuler l'édition SYNCHRONEMENT : un `setDraft(shown)` avant
  // le blur ne suffit pas — le `commitDraft` déclenché par ce blur s'exécute
  // AVANT le re-render et lirait encore le brouillon abandonné (constaté au
  // test d'interaction Storybook : « 999 » était committé malgré Échap).
  const abandonRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation d'un BROUILLON local sur la valeur externe, uniquement hors edition : la retirer ferait ecraser la frappe en cours, et un `key` de reset perdrait le focus du champ (teste par les interactions Storybook, dont le cas « Echap »).
    if (!isEditing) setDraft(shown);
  }, [isEditing, shown]);

  function commitDraft() {
    setIsEditing(false);
    if (abandonRef.current) {
      abandonRef.current = false;
      setDraft(shown);
      return;
    }
    const parsed = parse ? parse(draft) : parseControlValue(draft, min, max, step);
    if (parsed === null) {
      setDraft(shown);
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      // Commit par le seul `onBlur` — appeler `commitDraft()` ici EN PLUS
      // doublerait l'entrée d'historique (même piège que LabeledSlider).
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Abandon de l'édition du champ, jamais un commit.
      abandonRef.current = true;
      event.currentTarget.blur();
    }
  }

  const inline = labelPlacement === "inline";
  return (
    <div className={classNames?.root ?? cn(inline ? "flex items-center gap-2" : "flex flex-col gap-1", disabled && "opacity-50")}>
      <label
        htmlFor={id}
        className={cn(classNames?.label ?? "text-sm text-muted-foreground", labelPlacement === "hidden" ? "sr-only" : inline && "shrink-0")}
      >
        {label}
      </label>
      {/* `min-w-0` : sans lui la taille minimale automatique de cette boîte vaut
          celle de son contenu, et le champ pousserait la ligne au-delà de la
          colonne du dock au lieu de rétrécir avec elle. */}
      <div className={classNames?.field ?? "flex min-w-0 flex-1 items-center gap-2"}>
        <input
          id={id}
          className={classNames?.input ?? DEFAULT_INPUT_CLASS}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
        />
        {/* `aria-hidden` : l'unité est un repère VISUEL. Le nom accessible du
            champ vient de son étiquette, et la doubler d'un « % » flottant
            n'apporterait rien au lecteur d'écran. */}
        {unit !== undefined && (
          <span className={classNames?.unit ?? "shrink-0 text-sm text-muted-foreground"} aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
