import { Button } from "./ui/button";
import { Dialog } from "../ui/Dialog";
import type { parseFreeCanvasRequest } from "../layers/canvasFormat";

/**
 * Saisie libre des dimensions de la toile (tranche T2), extraite d'`App.tsx` le
 * 2026-08-01 avec les quatre dialogues de preset (item A1).
 *
 * Séparée d'eux, et pas rangée dans un `AppDialogs` fourre-tout : les quatre
 * autres appartiennent au parcours PRESET et se lisent ensemble, celui-ci
 * appartient à l'ouverture d'un document. Un composant qui n'a comme raison
 * d'être que « les modales qui restaient » n'aurait aucune frontière à tenir,
 * et le prochain dialogue y serait tombé sans qu'on se demande où il va.
 *
 * `validation` arrive DÉJÀ CALCULÉE. Ce composant pourrait appeler
 * `parseFreeCanvasRequest` lui-même — il ne le fait pas : `App.tsx` en a besoin
 * de son côté pour `confirmFreeCanvas`, et deux appels sur la même saisie
 * seraient deux vérités possibles pour une seule question. Le type est
 * néanmoins dérivé de cette fonction (`ReturnType`), pour qu'un ajout de cas
 * d'erreur ne puisse pas être oublié ici.
 */

export interface CanvasSizeDialogProps {
  /** Saisie en cours (texte brut, pas des nombres — le champ doit pouvoir être
   *  vide sans valoir zéro). `null` = dialogue fermé. */
  pending: { width: string; height: string } | null;
  onWidthChange: (width: string) => void;
  onHeightChange: (height: string) => void;
  /** Résultat de `parseFreeCanvasRequest` sur la saisie courante. */
  validation: ReturnType<typeof parseFreeCanvasRequest> | null;
  /** Budget de pixels de la toile, affiché dans la description (ADR-0007). */
  maxCanvasPixels: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CanvasSizeDialog({
  pending,
  onWidthChange,
  onHeightChange,
  validation,
  maxCanvasPixels,
  onCancel,
  onConfirm,
}: CanvasSizeDialogProps) {
  return (
    <Dialog
      open={pending !== null}
      title="Taille de la toile"
      description={`En pixels. La photo sera centrée sur cette toile, sans être redimensionnée. Budget maximal : ${(maxCanvasPixels / 1e6).toFixed(0)} Mpx.`}
      onClose={onCancel}
      actions={
        <>
          <Button
            variant="secondary"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- dialogue MODAL, focus sur l'action sans effet (Annuler) : voir la meme note sur le dialogue « Remplacer ? » de PresetDialogs.
            autoFocus
            onClick={onCancel}
          >
            Annuler
          </Button>
          <Button variant="default" disabled={validation?.kind !== "ok"} onClick={onConfirm}>
            Choisir une photo...
          </Button>
        </>
      }
    >
      <div className="canvas-size-dialog">
        <label className="canvas-size-dialog__field">
          Largeur
          <input
            type="number"
            min={1}
            className="preset-panel__name-input"
            value={pending?.width ?? ""}
            onChange={(e) => onWidthChange(e.target.value)}
          />
        </label>
        <label className="canvas-size-dialog__field">
          Hauteur
          <input
            type="number"
            min={1}
            className="preset-panel__name-input"
            value={pending?.height ?? ""}
            onChange={(e) => onHeightChange(e.target.value)}
          />
        </label>
        {/* Le message de refus est visible AVANT le clic, jamais après :
            le bouton est désactivé tant que la saisie n'est pas valide. */}
        {validation?.kind === "erreur" && (
          <p className="canvas-size-dialog__error" role="status">
            {validation.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
