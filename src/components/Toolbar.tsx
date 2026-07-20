import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
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
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onOpenFile: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport, onOpenFile }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Barre d'outils"
      className="flex items-center gap-4 min-h-[var(--toolbar-height)] px-4 py-3 bg-card border-b border-border"
    >
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary">Fichier</Button>} />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onOpenFile}>
            <FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport}>
            <Download size={16} strokeWidth={1.5} aria-hidden="true" />
            Exporter
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
        <Undo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Rétablir"
        title="Rétablir (Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <div className="flex-1" />
    </div>
  );
}
