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
        {/* « Dépose un JPEG ici » jusqu'au 2026-08-18 : le texte décrivait le
            filtre du sélecteur, pas ce que la toile accepte — or elle n'a
            jamais eu de filtre, et un PNG à alpha s'y composait déjà. */}
        <p className="pasteboard__empty-description">Dépose une image ici ou choisis un fichier pour commencer.</p>
      </div>
      <Button variant="default" onClick={onOpenFile}>
        <FolderOpen aria-hidden="true" />
        Ouvrir une image
      </Button>
    </div>
  );
}
