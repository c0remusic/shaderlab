import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LayerState, LayerTransform } from "../layers/types";
import { parseControlValue } from "../ui/formatValue";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/collapsible";
import "./PhotoPanel.css";

/** Bornes de saisie des champs de placement. Larges à dessein : une photo
 *  peut légitimement être positionnée hors du fond (seule la partie qui
 *  recouvre le fond est composée). `SCALE_MIN_PERCENT` reprend
 *  `MIN_TRANSFORM_SCALE` (2 %) — la même borne que le drag de coin. */
const POSITION_LIMIT_PX = 100000;
const SCALE_MIN_PERCENT = 2;
const SCALE_MAX_PERCENT = 2000;

interface NumberFieldProps {
  label: string;
  /** Valeur affichée, DÉJÀ dans l'unité du champ (px, %, °). */
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}

/**
 * Champ numérique de placement. Même contrat de commit que le champ de
 * valeur de `LabeledSlider` : brouillon local pendant l'édition, commit au
 * `blur` (et `Entrée` ne fait que blurrer, jamais committer deux fois — la
 * prop contrôlée n'est pas rafraîchie entre les deux). `Échap` abandonne
 * l'édition du champ sans rien committer.
 */
function NumberField({ label, value, unit, min, max, step, onCommit }: NumberFieldProps) {
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
    if (!isEditing) setDraft(shown);
  }, [isEditing, shown]);

  function commitDraft() {
    setIsEditing(false);
    if (abandonRef.current) {
      abandonRef.current = false;
      setDraft(shown);
      return;
    }
    const parsed = parseControlValue(draft, min, max, step);
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

  return (
    <div className="photo-panel__field">
      <label className="photo-panel__field-label" htmlFor={id}>
        {label}
      </label>
      <div className="photo-panel__field-input">
        <input
          id={id}
          className="photo-panel__input"
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
        />
        <span className="photo-panel__unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  );
}

interface Props {
  /** Calque photo sélectionné, ou `null` (aucune sélection, ou sélection non
   *  photo) — le rail peut ouvrir ce panneau hors condition, l'état vide est
   *  donc obligatoire (design §3.7). */
  layer: LayerState | null;
  thumbnailUrl: (sourceId: string) => string | null;
  onTransformChange: (id: string, transform: LayerTransform) => void;
  onTransformCommit: () => void;
  onReset: (id: string) => void;
  onFitToCanvas: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * Panneau « Photo » — 5ᵉ panneau contextuel du dock, propriétés du calque
 * PHOTO sélectionné (design
 * `docs/superpowers/specs/2026-07-27-shaderlab-panneau-photo-et-ecretage-design.md`
 * §3.7). Aucune logique : il traduit les champs en `LayerTransform` et
 * délègue ; toute la géométrie vit dans `src/ui/transform.ts` et les
 * handlers dans `src/hooks/usePhotoLayer.ts`.
 *
 * Reste utilisable dans les TROIS modes de canvas (idle/maskPaint/crop) : un
 * champ numérique du dock n'intercepte aucun geste de pinceau, contrairement
 * aux poignées du canvas que `showsTransformHandles` gouverne.
 *
 * Sections = `Disclosure`, le seul pattern de section des panneaux du dock
 * (`ParamPanel`, `MaskPanel`). Aucun titre sémantique (`<h1>`…`<h6>`) : le
 * dock n'en a pas, et en introduire ici partirait d'un `<h3>` dans un écran
 * sans `<h1>` ni `<h2>` — un saut de niveau, donc un défaut d'accessibilité.
 * Le titre d'une section est le libellé du bouton qui la replie.
 */
export function PhotoPanel({ layer, thumbnailUrl, onTransformChange, onTransformCommit, onReset, onFitToCanvas, onCenter }: Props) {
  // Liaisons LOCALES (`const`) avant la garde : le paramètre `layer` n'est
  // pas `const` pour TypeScript, son affinement ne survivrait pas dans les
  // callbacks ci-dessous.
  const imageSource = layer?.imageSource;
  const transform = layer?.transform;
  if (!layer || !imageSource || !transform) {
    return <p className="photo-panel__empty">Sélectionne un calque photo.</p>;
  }

  const layerId = layer.id;
  const layerName = layer.name;
  const thumbnail = thumbnailUrl(imageSource.sourceId);

  // Un commit de champ = un `onTransformChange` puis un `onTransformCommit`,
  // soit EXACTEMENT une entrée d'historique (le commit ne pousse rien si
  // rien n'a bougé, cf. `paramDirtyRef`).
  function commitTransform(next: LayerTransform) {
    onTransformChange(layerId, next);
    onTransformCommit();
  }

  return (
    <div className="photo-panel">
      <Disclosure title="Source" defaultOpen>
        <div className="photo-panel__source">
          {thumbnail ? (
            <img className="photo-panel__thumbnail" src={thumbnail} alt="" aria-hidden="true" />
          ) : (
            <span className="photo-panel__thumbnail photo-panel__thumbnail--empty" aria-hidden="true" />
          )}
          <span className="photo-panel__source-name" title={layerName ?? undefined}>
            {layerName ?? "Photo importée"}
          </span>
        </div>
      </Disclosure>

      <Disclosure title="Placement" defaultOpen>
        <div className="photo-panel__fields">
          <NumberField
            label="X"
            unit="px"
            value={Math.round(transform.x)}
            min={-POSITION_LIMIT_PX}
            max={POSITION_LIMIT_PX}
            step={1}
            onCommit={(x) => commitTransform({ ...transform, x })}
          />
          <NumberField
            label="Y"
            unit="px"
            value={Math.round(transform.y)}
            min={-POSITION_LIMIT_PX}
            max={POSITION_LIMIT_PX}
            step={1}
            onCommit={(y) => commitTransform({ ...transform, y })}
          />
          <NumberField
            label="Échelle"
            unit="%"
            value={Math.round(transform.scale * 100)}
            min={SCALE_MIN_PERCENT}
            max={SCALE_MAX_PERCENT}
            step={1}
            onCommit={(percent) => commitTransform({ ...transform, scale: percent / 100 })}
          />
          <NumberField
            label="Angle"
            unit="°"
            value={Math.round((transform.rotation * 180) / Math.PI)}
            min={-360}
            max={360}
            step={1}
            onCommit={(degrees) => commitTransform({ ...transform, rotation: (degrees * Math.PI) / 180 })}
          />
        </div>
      </Disclosure>

      <Disclosure title="Actions" defaultOpen>
        <div className="photo-panel__actions">
          <Button size="sm" variant="secondary" onClick={() => onReset(layerId)}>
            Réinitialiser
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onFitToCanvas(layerId)}>
            Ajuster à la toile
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onCenter(layerId)}>
            Centrer
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}
