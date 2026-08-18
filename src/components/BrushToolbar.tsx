import { Brush, Eraser } from "lucide-react";
import { LabeledSlider } from "./ui/labeled-slider";
import { Toggle } from "./ui/toggle";
import { Button } from "./ui/button";

interface Props {
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (v: number) => void;
  /** Plafond du trait. Repasser au cours du MÊME trait ne le dépasse jamais. */
  brushOpacity: number;
  onBrushOpacityChange: (v: number) => void;
  /** Dépôt par tampon. Bas = la valeur monte en repassant, façon aérographe. */
  brushFlow: number;
  onBrushFlowChange: (v: number) => void;
  erase: boolean;
  onEraseChange: (v: boolean) => void;
  /** Remplit le masque du calque sélectionné — c'est le geste qui ouvre le
   *  travail à la gomme sur un calque jamais peint. */
  onFillMask: () => void;
  /** Vide le masque SANS le supprimer : la source pinceau reste en place,
   *  remplie de zéros. Supprimer le masque est une autre action, ailleurs
   *  (panneau Masque), parce qu'elle rend le calque à l'ABSENCE de masque. */
  onClearMask: () => void;
  /** Sort du mode peinture (bouton « Quitter la peinture »). Le libellé dit
   *  explicitement qu'on QUITTE un mode, et non qu'on « termine » le masque :
   *  peinture et poignées de transform s'excluent (design T1), donc déplacer
   *  ou redimensionner la photo passe obligatoirement par ce bouton. */
  onStop: () => void;
}

/**
 * Réglages du pinceau — le CONTENU que `ToolOptionsBar` affiche quand l'outil
 * actif est le pinceau ou la gomme. Taille, dureté, opacité, débit, gomme, plus
 * les deux actions de masque global.
 *
 * ⚠️ IL N'EST PLUS SA PROPRE BARRE (2026-08-18, ticket 27). Il portait
 * `.brush-toolbar` et n'était monté qu'en mode masque, ce qui produisait le
 * défaut mesuré à 1280 × 720 : en passant de *Déplacer* au *Pinceau*, la barre
 * apparaissait et **la palette d'outils descendait de 75 px** — la rangée de
 * boutons glissait sous le curseur au moment même où on cliquait dedans. Le
 * conteneur est désormais permanent et à hauteur constante ; ce composant ne
 * rend plus qu'une suite de contrôles.
 *
 * **Pourquoi Remplir/Vider ici et pas dans le panneau Masque** (ADR-0001) :
 * cette barre est une zone de contrôles fixe, hors du conteneur défilant du
 * dock, et ces deux gestes n'apparaissent qu'avec l'outil pinceau — soit
 * exactement le moment où ils ont un sens. Les poser dans la carte Masque
 * ajouterait deux lignes à une colonne dont la hauteur est sous budget, pour des
 * actions qui y seraient inertes la plupart du temps.
 */
export function BrushToolbar({
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  brushOpacity,
  onBrushOpacityChange,
  brushFlow,
  onBrushFlowChange,
  erase,
  onEraseChange,
  onFillMask,
  onClearMask,
  onStop,
}: Props) {
  return (
    <>
      <span className="brush-toolbar__tool">
        <Brush className="icon-md icon-stroke" aria-hidden="true" />
        Pinceau
      </span>
      <div className="brush-toolbar__control">
        <LabeledSlider
          label="Taille"
          displayValue={`${Math.round(brushSize)} px`}
          value={brushSize}
          min={2}
          max={200}
          onChange={onBrushSizeChange}
        />
      </div>
      <div className="brush-toolbar__control">
        <LabeledSlider
          label="Dureté"
          displayValue={`${Math.round(brushHardness * 100)} %`}
          value={brushHardness}
          min={0}
          max={1}
          step={0.05}
          onChange={onBrushHardnessChange}
        />
      </div>
      <div className="brush-toolbar__control">
        <LabeledSlider
          label="Opacité"
          displayValue={`${Math.round(brushOpacity * 100)} %`}
          value={brushOpacity}
          min={0}
          max={1}
          step={0.01}
          onChange={onBrushOpacityChange}
        />
      </div>
      <div className="brush-toolbar__control">
        <LabeledSlider
          label="Débit"
          displayValue={`${Math.round(brushFlow * 100)} %`}
          value={brushFlow}
          min={0.01}
          max={1}
          step={0.01}
          onChange={onBrushFlowChange}
        />
      </div>
      <Toggle size="sm" pressed={erase} onPressedChange={onEraseChange} aria-label="Gomme">
        <Eraser className="icon-md icon-stroke" aria-hidden="true" />
        Gomme
      </Toggle>
      <div className="brush-toolbar__actions" role="group" aria-label="Masque entier">
        <Button
          variant="secondary"
          size="sm"
          onClick={onFillMask}
          title="Remplir tout le masque — permet ensuite de travailler à la gomme"
        >
          Remplir
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onClearMask}
          title="Vider tout le masque sans le supprimer (le calque garde son masque, vide)"
        >
          Vider
        </Button>
      </div>
      <div className="brush-toolbar__spacer" />
      <Button
        variant="secondary"
        size="sm"
        onClick={onStop}
        title="Quitter la peinture pour retrouver les poignées de déplacement et de redimensionnement"
      >
        Quitter la peinture
      </Button>
    </>
  );
}
