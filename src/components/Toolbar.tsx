import { memo } from "react";
import { Download, FolderOpen, Frame, ImagePlus, Menu, Redo2, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  NAMED_CANVAS_FORMAT_LABELS,
  type NamedCanvasFormat,
} from "../layers/canvasFormat";

/** Ordre d'affichage des formats nommés — le plus proche d'une photo d'abord,
 *  le format d'impression en dernier. Explicite plutôt que l'ordre des clés
 *  d'un objet. */
const NAMED_FORMAT_ORDER: NamedCanvasFormat[] = ["carre", "quatre-cinq", "a3"];

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  hasImage: boolean;
  fileName: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onExportAs: () => void;
  /** « Ouvrir » nu : la toile prend les dimensions de la photo, comme avant la
   *  tranche T2. C'est le chemin par défaut et il ne demande rien. */
  onOpenFile: () => void;
  /** « Ouvrir dans un format… » : un format nommé, dérivé de la photo ouverte. */
  onOpenFileWithFormat: (format: NamedCanvasFormat) => void;
  /** « Ouvrir dans une taille libre… » : ouvre la saisie des dimensions AVANT le
   *  sélecteur de fichier. */
  onOpenFileWithFreeSize: () => void;
  onImportPhotoLayer: () => void;
  canImportPhotoLayer: boolean;
}

/** MÉMOÏSÉ (2026-07-30, profil CPU). Aucune de ses props ne bouge pendant un
 *  geste — ni l'historique (aucun commit avant la fin du geste), ni le nom du
 *  document, ni la présence d'image — et il se rendait pourtant à chaque
 *  `pointermove` (31 rendus pour 30 échantillons, mesuré). Tient uniquement
 *  parce que les huit callbacks passés par `App` sont en `useCallback`. */
export const Toolbar = memo(function Toolbar({
  canUndo,
  canRedo,
  hasImage,
  fileName,
  onUndo,
  onRedo,
  onExport,
  onExportAs,
  onOpenFile,
  onOpenFileWithFormat,
  onOpenFileWithFreeSize,
  onImportPhotoLayer,
  canImportPhotoLayer,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Barre d'outils"
      className="flex items-center gap-4 min-h-[var(--toolbar-height)] px-4 py-3 bg-card border-b border-border"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="secondary" size="icon" aria-label="Menu Fichier" title="Fichier">
              <Menu size={16} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {/* « Ouvrir » reste NU et premier : ouvrir sans rien choisir donne la
              toile aux dimensions de la photo, exactement comme avant la tranche
              T2. Le choix de format est une entrée SÉPARÉE, jamais un dialogue
              interposé sur ce chemin-là. */}
          <DropdownMenuItem onClick={onOpenFile}>
            <FolderOpen className="icon-md icon-stroke" aria-hidden="true" />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Frame className="icon-md icon-stroke" aria-hidden="true" />
              Ouvrir dans un format de toile
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {NAMED_FORMAT_ORDER.map((format) => (
                <DropdownMenuItem key={format} onClick={() => onOpenFileWithFormat(format)}>
                  {NAMED_CANVAS_FORMAT_LABELS[format]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={onOpenFileWithFreeSize}>Taille libre...</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={onImportPhotoLayer} disabled={!hasImage || !canImportPhotoLayer}>
            <ImagePlus className="icon-md icon-stroke" aria-hidden="true" />
            Importer une 2e photo (double exposure)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport} disabled={!hasImage}>
            <Download className="icon-md icon-stroke" aria-hidden="true" />
            Exporter
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportAs} disabled={!hasImage}>
            <Download className="icon-md icon-stroke" aria-hidden="true" />
            Exporter sous...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Annuler"
        title="Annuler (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="icon-md icon-stroke" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Rétablir"
        title="Rétablir (Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="icon-md icon-stroke" aria-hidden="true" />
      </Button>
      <div className="flex-1" />
      {hasImage && fileName && (
        <span
          className="max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground"
          title={fileName}
        >
          {fileName}
        </span>
      )}
      <div className="flex-1" />
    </div>
  );
});
