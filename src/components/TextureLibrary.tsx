import { memo, useEffect, useRef } from "react";
import type { TextureThumbnail } from "../textures/thumbnailCache";
import { Button } from "./ui/button";
import "./TextureLibrary.css";

export interface TextureLibraryProps {
  /** Dossier courant, ou `null` si aucun n'a pu être résolu. */
  dir: string | null;
  /** Chemins ABSOLUS, triés — voir `list_texture_files` côté Rust. */
  files: string[];
  thumbnails: ReadonlyMap<string, TextureThumbnail>;
  error: string | null;
  /** `device.limits.maxTextureDimension2D`. Au-delà, `assertImageFitsGpu`
   *  refuse l'image : la cellule est désactivée AVANT le clic plutôt que de
   *  produire un bandeau d'erreur après. */
  maxTextureDimension: number;
  /** Faux quand le plafond de calques photo est atteint — une texture en est
   *  un (`MAX_PHOTO_LAYERS`). */
  canAdd: boolean;
  onPickFolder: () => void;
  /** Appelé quand une cellule entre dans le champ de vision. */
  onRequestThumbnail: (path: string) => void;
  onAdd: (path: string) => void;
}

/** Marge de préchargement autour du champ de vision. Une bande de 200 px fait
 *  arriver les vignettes juste avant qu'on les atteigne, sans précharger le
 *  dossier entier. */
const PREFETCH_MARGIN = "200px";

function fileName(path: string): string {
  const last = path.split(/[\\/]/).pop();
  return last !== undefined && last.length > 0 ? last : path;
}

/** MÉMOÏSÉ, même raison que `PresetPanel` : rien de ce panneau ne dépend de ce
 *  qui bouge pendant un geste. Ne tient QUE si `App` passe des rappels stables
 *  — ceux de `useTextureLibrary` sont en `useCallback` pour cette raison. */
export const TextureLibrary = memo(function TextureLibrary({
  dir,
  files,
  thumbnails,
  error,
  maxTextureDimension,
  canAdd,
  onPickFolder,
  onRequestThumbnail,
  onAdd,
}: TextureLibraryProps) {
  const gridRef = useRef<HTMLUListElement>(null);

  // Chargement PARESSEUX. Sans lui, ouvrir un dossier de 83 scans 8K ferait
  // transiter ~1,6 Go par l'IPC pour afficher une douzaine de cases visibles.
  //
  // `root: null` (le viewport) et non la grille : la carte du dock possède sa
  // propre boîte défilante, la grille n'est pas l'élément qui défile. Un
  // `IntersectionObserver` sur le viewport tient compte du rognage par les
  // conteneurs défilants intermédiaires, donc il voit juste dans les deux cas.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    if (typeof IntersectionObserver === "undefined") {
      // Pas d'observateur (env de test sans DOM complet) : tout charger plutôt
      // qu'afficher une grille définitivement vide. C'est le cas dégradé, pas
      // le cas nominal.
      for (const path of files) onRequestThumbnail(path);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const path = (entry.target as HTMLElement).dataset.path;
          if (path !== undefined) onRequestThumbnail(path);
          // Une vignette chargée le reste : ré-observer ne ferait que
          // rappeler `onRequestThumbnail` à chaque passage de défilement.
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    for (const cell of grid.querySelectorAll<HTMLElement>("[data-path]")) observer.observe(cell);
    return () => observer.disconnect();
  }, [files, onRequestThumbnail]);

  return (
    <div className="texture-library">
      {/* Zone de contrôles UNIQUE et hors de la grille (ADR-0001) : le dossier
          et son bouton n'appartiennent à aucune texture, ils agissent sur la
          bibliothèque entière. */}
      <div className="texture-library__controls">
        <span className="texture-library__dir" title={dir ?? undefined}>
          {dir === null ? "Aucun dossier" : fileName(dir)}
        </span>
        <span className="texture-library__count">{files.length > 0 ? `${files.length}` : ""}</span>
        <Button variant="secondary" size="sm" onClick={onPickFolder}>
          Dossier…
        </Button>
      </div>

      {error !== null && <p className="texture-library__error">{error}</p>}

      {files.length === 0 ? (
        <p className="texture-library__empty">
          {dir === null
            ? "Aucun dossier de textures. Choisis-en un : scans de papier, grain, rayures, matières."
            : "Ce dossier ne contient aucune image (JPEG ou PNG, sous-dossiers compris)."}
        </p>
      ) : (
        <ul
          ref={gridRef}
          // `data-dock-list` : voir `PanelColumn.tsx` § COÛT DU HORS-LISTE —
          // la zone de contrôles vit dans la même boîte défilante et ne doit
          // pas être décomptée du plancher de lignes.
          data-dock-list=""
          className="texture-library__grid"
        >
          {files.map((path) => {
            const thumb = thumbnails.get(path) ?? null;
            const size = thumb?.size ?? null;
            const tooLarge =
              size !== null && (size.width > maxTextureDimension || size.height > maxTextureDimension);
            const disabled = tooLarge || !canAdd;
            const title = tooLarge
              ? `${fileName(path)} — ${size.width} × ${size.height} px, au-delà de la limite de texture du GPU (${maxTextureDimension} px).`
              : !canAdd
                ? `${fileName(path)} — plafond de calques d'image atteint.`
                : path;
            return (
              <li key={path} className="texture-library__cell" data-path={path}>
                <button
                  type="button"
                  className="texture-library__button"
                  disabled={disabled}
                  title={title}
                  onClick={() => onAdd(path)}
                >
                  <span className="texture-library__frame">
                    {thumb?.url != null && (
                      // `alt` vide et non descriptif : le nom du fichier est
                      // juste en dessous, dans le même bouton — le répéter
                      // ferait lire deux fois la même chose à un lecteur
                      // d'écran.
                      <img className="texture-library__image" src={thumb.url} alt="" />
                    )}
                  </span>
                  <span className="texture-library__name">{fileName(path)}</span>
                  <span className={`texture-library__size${tooLarge ? " texture-library__size--over" : ""}`}>
                    {size === null ? "…" : `${size.width} × ${size.height}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
