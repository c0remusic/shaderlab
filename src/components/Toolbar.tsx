import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

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
    <div className="toolbar" role="toolbar" aria-label="Barre d'outils">
      <Button variant="secondary" onClick={onOpenFile}>
        <FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />
        Ouvrir
      </Button>
      <IconButton
        label="Annuler"
        tooltip="Annuler (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
      <IconButton
        label="Rétablir"
        tooltip="Rétablir (Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
      <div className="toolbar__spacer" />
      <Button variant="primary" onClick={onExport}>
        <Download size={16} strokeWidth={1.5} aria-hidden="true" />
        Exporter
      </Button>
    </div>
  );
}
