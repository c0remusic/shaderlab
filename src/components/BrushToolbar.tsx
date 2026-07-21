import { Brush, Eraser } from "lucide-react";
import { Slider } from "./ui/slider";
import { Toggle } from "./ui/toggle";
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
        <span className="text-xs text-muted-foreground">Taille</span>
        <Slider
          aria-label="Taille"
          value={[brushSize]}
          min={2}
          max={200}
          onValueChange={(v) => onBrushSizeChange(Array.isArray(v) ? v[0] : v)}
        />
      </div>
      <div className="brush-toolbar__control">
        <span className="text-xs text-muted-foreground">Dureté</span>
        <Slider
          aria-label="Dureté"
          value={[brushHardness]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={(v) => onBrushHardnessChange(Array.isArray(v) ? v[0] : v)}
        />
      </div>
      <Toggle pressed={erase} onPressedChange={onEraseChange} aria-label="Gomme">
        <Eraser size={16} strokeWidth={1.5} aria-hidden="true" />
        Gomme
      </Toggle>
      <div className="brush-toolbar__spacer" />
      <Button variant="secondary" onClick={onStop}>
        Terminer
      </Button>
    </div>
  );
}
