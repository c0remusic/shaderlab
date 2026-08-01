import { FolderOpen } from "lucide-react";
import { Button } from "./ui/button";

interface EmptyWorkspaceProps {
  onOpenFile: () => void;
}

export function EmptyWorkspace({ onOpenFile }: EmptyWorkspaceProps) {
  return (
    <div className="pasteboard__empty-workspace">
      <div className="pasteboard__empty-copy">
        <h1 className="pasteboard__empty-heading">Ouvrir une photo</h1>
        <p className="pasteboard__empty-description">Dépose un JPEG ici ou choisis un fichier pour commencer.</p>
      </div>
      <Button variant="default" onClick={onOpenFile}>
        <FolderOpen aria-hidden="true" />
        Ouvrir une image
      </Button>
    </div>
  );
}
