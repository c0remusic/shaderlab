import { Download, FolderOpen, ImagePlus, Menu, Redo2, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  hasImage: boolean;
  fileName: string | null;
  hasLaunchFile: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onExportAs: () => void;
  onOpenFile: () => void;
  onImportPhotoLayer: () => void;
  canImportPhotoLayer: boolean;
}

export function Toolbar({
  canUndo,
  canRedo,
  hasImage,
  fileName,
  hasLaunchFile,
  onUndo,
  onRedo,
  onExport,
  onExportAs,
  onOpenFile,
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
          <DropdownMenuItem onClick={onOpenFile}>
            <FolderOpen className="icon-md icon-stroke" aria-hidden="true" />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportPhotoLayer} disabled={!hasImage || !canImportPhotoLayer}>
            <ImagePlus className="icon-md icon-stroke" aria-hidden="true" />
            Importer une 2e photo (double exposure)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport} disabled={!hasImage}>
            <Download className="icon-md icon-stroke" aria-hidden="true" />
            Exporter
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportAs} disabled={!hasImage || hasLaunchFile}>
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
}
