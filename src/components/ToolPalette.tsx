import { memo } from "react";
import { Brush, Crop, Eraser, MousePointer2, Square, type LucideIcon } from "lucide-react";
import { Toggle } from "./ui/toggle";
import { TOOLS, type ToolId } from "../ui/tools";

/** Icône par outil. Table SÉPARÉE de `TOOLS` (`src/ui/tools.ts`) à dessein :
 *  ce module-là est pur et testable en Node, y importer `lucide-react` le
 *  rendrait dépendant du rendu. */
const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  move: MousePointer2,
  brush: Brush,
  eraser: Eraser,
  // Un CARRÉ plein, et non une icône de « forme » générique : l'outil ne trace
  // qu'un rectangle aujourd'hui, et une icône qui promettrait un choix de
  // primitives mentirait sur ce que le geste fait.
  shape: Square,
  crop: Crop,
};

interface Props {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  /** Aucun document ouvert : les outils n'ont rien sur quoi agir. */
  disabled?: boolean;
}

/**
 * Palette d'outils commutables, à la Photoshop.
 *
 * Remplace le va-et-vient vers la bascule « peinture » enfouie dans la carte
 * Masque du dock : l'outil se choisit ici ou au clavier, et reste choisi.
 *
 * Densité (ADR-0001) : UNE zone de contrôles unique, agissant sur le canvas
 * courant, hors de tout conteneur défilant — c'est exactement la forme que
 * l'ADR impose, et l'inverse d'un contrôle répété par ligne de liste. La
 * colonne verticale est posée sur le bord gauche de l'espace de travail, là où
 * elle ne dispute aucune place au dock de droite.
 */
export const ToolPalette = memo(function ToolPalette({ activeTool, onSelectTool, disabled }: Props) {
  return (
    <div className="tool-palette" role="toolbar" aria-label="Outils" aria-orientation="vertical">
      {TOOLS.map((tool) => {
        const Icon = TOOL_ICONS[tool.id];
        const active = tool.id === activeTool;
        return (
          <Toggle
            key={tool.id}
            size="sm"
            pressed={active}
            disabled={disabled}
            // `onPressedChange` et non `onClick` : recliquer l'outil DÉJÀ actif
            // ne doit pas le désélectionner — une palette sans outil actif
            // n'existe pas. On ignore donc le passage à `false`.
            onPressedChange={(next) => {
              if (next) onSelectTool(tool.id);
            }}
            aria-label={tool.label}
            title={`${tool.label} (${tool.shortcutLabel}) — ${tool.hint}`}
          >
            <Icon className="icon-md icon-stroke" aria-hidden="true" />
          </Toggle>
        );
      })}
    </div>
  );
});
