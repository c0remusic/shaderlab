import { Brush, Eraser } from "lucide-react";
import { LabeledSlider } from "./ui/labeled-slider";
import { Toggle } from "./ui/toggle";
import { Button } from "./ui/button";

interface Props {
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (v: number) => void;
  erase: boolean;
  onEraseChange: (v: boolean) => void;
  /** Sort du mode peinture (bouton « Terminer »). */
  onStop: () => void;
}

/**
 * Barre d'options du pinceau (style barre d'outils Photoshop) — affichée
 * uniquement en mode masque. Regroupe les réglages du pinceau (taille, dureté,
 * gomme) dans une surface horizontale visible, au lieu de les enfouir dans
 * l'inspecteur.
 */
export function BrushToolbar({
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  erase,
  onEraseChange,
  onStop,
}: Props) {
  return (
    <div className="brush-toolbar" role="toolbar" aria-label="Options du pinceau">
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
      <Toggle size="sm" pressed={erase} onPressedChange={onEraseChange} aria-label="Gomme">
        <Eraser className="icon-md icon-stroke" aria-hidden="true" />
        Gomme
      </Toggle>
      <div className="brush-toolbar__spacer" />
      <Button variant="secondary" size="sm" onClick={onStop}>
        Terminer
      </Button>
    </div>
  );
}
