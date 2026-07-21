import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyWorkspaceProps {
  onOpenFile: () => void;
}

export function EmptyWorkspace({ onOpenFile }: EmptyWorkspaceProps) {
  return (
    <div className="canvas-stage__empty-workspace">
      <div className="canvas-stage__empty-copy">
        <h1 className="canvas-stage__empty-heading">Ouvrir une photo</h1>
        <p className="canvas-stage__empty-description">Dépose un JPEG ici ou choisis un fichier pour commencer.</p>
      </div>
      <Button variant="primary" onClick={onOpenFile}>
        <FolderOpen aria-hidden="true" />
        Ouvrir une image
      </Button>
    </div>
  );
}
