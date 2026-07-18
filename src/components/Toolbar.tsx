import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";

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
      <Menu
        label="Fichier"
        variant="secondary"
        items={[
          {
            value: "open",
            label: "Ouvrir",
            icon: <FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />,
            onSelect: onOpenFile,
          },
          {
            value: "export",
            label: "Exporter",
            icon: <Download size={16} strokeWidth={1.5} aria-hidden="true" />,
            onSelect: onExport,
          },
        ]}
      />
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
    </div>
  );
}
