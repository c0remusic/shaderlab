import { Brush, Eraser } from "lucide-react";
import { Slider } from "../ui/Slider";
import { Button } from "../ui/Button";

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
        <Brush size={16} strokeWidth={1.5} aria-hidden="true" />
        Pinceau
      </span>
      <div className="brush-toolbar__control">
        <Slider label="Taille" value={brushSize} min={2} max={200} onChange={onBrushSizeChange} />
      </div>
      <div className="brush-toolbar__control">
        <Slider
          label="Dureté"
          value={brushHardness}
          min={0}
          max={1}
          step={0.05}
          onChange={onBrushHardnessChange}
        />
      </div>
      <Button variant={erase ? "primary" : "secondary"} onClick={() => onEraseChange(!erase)}>
        <Eraser size={16} strokeWidth={1.5} aria-hidden="true" />
        Gomme
      </Button>
      <div className="brush-toolbar__spacer" />
      <Button variant="secondary" onClick={onStop}>
        Terminer
      </Button>
    </div>
  );
}
