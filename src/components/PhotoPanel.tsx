import type { LayerState, LayerTransform } from "../layers/types";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/collapsible";
import { NumberField, type NumberFieldClassNames } from "./ui/number-field";
import "./PhotoPanel.css";

/** Bornes de saisie des champs de placement. Larges à dessein : une photo
 *  peut légitimement être positionnée hors du fond (seule la partie qui
 *  recouvre le fond est composée). `SCALE_MIN_PERCENT` reprend
 *  `MIN_TRANSFORM_SCALE` (2 %) — la même borne que le drag de coin. */
const POSITION_LIMIT_PX = 100000;
const SCALE_MIN_PERCENT = 2;
const SCALE_MAX_PERCENT = 2000;

/** Le champ numérique a été EXTRAIT vers `components/ui/number-field.tsx` le
 *  2026-07-28 (l'en-tête compact du panneau Effets en avait besoin pour son
 *  opacité). Ces classes sont celles d'avant l'extraction, à l'identique :
 *  `NumberFieldClassNames` remplace le style par défaut au lieu de s'y ajouter,
 *  donc `PhotoPanel.css` reste seul maître du rendu de ces quatre champs. */
const PHOTO_FIELD_CLASSES: NumberFieldClassNames = {
  root: "photo-panel__field",
  label: "photo-panel__field-label",
  field: "photo-panel__field-input",
  input: "photo-panel__input",
  unit: "photo-panel__unit",
};

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
  /** Remplace l'image du calque (tranche T2) : ouvre le sélecteur de fichier,
   *  puis change la source SANS toucher au reste du calque. */
  onReplaceImage: (id: string) => void;
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
export function PhotoPanel({ layer, thumbnailUrl, onTransformChange, onTransformCommit, onReset, onFitToCanvas, onCenter, onReplaceImage }: Props) {
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
        <div className="photo-panel__source-group">
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
          {/* Remplacer l'image (T2) : la pile, les masques, les effets et
              l'historique du calque survivent — seule la source change. UN
              contrôle, dans la section qu'il concerne, agissant sur le calque
              SÉLECTIONNÉ (ADR-0001) ; il ne se répète sur aucune ligne.
              Désactivé sur un calque verrouillé, au même titre que « Ajouter
              une source » de MaskPanel — le refus du modèle
              (`LayerStack.setLayerImageSource`) reste la garde réelle. */}
          <div className="photo-panel__actions">
            <Button size="sm" variant="secondary" disabled={layer.locked === true} onClick={() => onReplaceImage(layerId)}>
              Remplacer l'image…
            </Button>
          </div>
        </div>
      </Disclosure>

      <Disclosure title="Placement" defaultOpen>
        <div className="photo-panel__fields">
          <NumberField
            classNames={PHOTO_FIELD_CLASSES}
            label="X"
            unit="px"
            value={Math.round(transform.x)}
            min={-POSITION_LIMIT_PX}
            max={POSITION_LIMIT_PX}
            step={1}
            onCommit={(x) => commitTransform({ ...transform, x })}
          />
          <NumberField
            classNames={PHOTO_FIELD_CLASSES}
            label="Y"
            unit="px"
            value={Math.round(transform.y)}
            min={-POSITION_LIMIT_PX}
            max={POSITION_LIMIT_PX}
            step={1}
            onCommit={(y) => commitTransform({ ...transform, y })}
          />
          <NumberField
            classNames={PHOTO_FIELD_CLASSES}
            label="Échelle"
            unit="%"
            value={Math.round(transform.scale * 100)}
            min={SCALE_MIN_PERCENT}
            max={SCALE_MAX_PERCENT}
            step={1}
            onCommit={(percent) => commitTransform({ ...transform, scale: percent / 100 })}
          />
          <NumberField
            classNames={PHOTO_FIELD_CLASSES}
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
