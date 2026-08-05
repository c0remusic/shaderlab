import { useEffect, useRef } from "react";
import type { TextureThumbnail } from "../textures/thumbnailCache";
import "./TexturePicker.css";

export interface TexturePickerProps {
  label: string;
  /** Chemins ABSOLUS, triés — le catalogue de la bibliothèque. L'INDEX dans ce
   *  tableau EST la valeur du paramètre (`EffectModule.libraryTexture`). */
  files: readonly string[];
  thumbnails: ReadonlyMap<string, TextureThumbnail>;
  /** Rang courant. Peut pointer hors du catalogue — un preset enregistré sur un
   *  autre dossier, ou un fichier retiré depuis. */
  value: number;
  disabled: boolean;
  onChange: (index: number) => void;
  onRequestThumbnail: (path: string) => void;
}

const PREFETCH_MARGIN = "150px";

function fileName(path: string): string {
  const last = path.split(/[\\/]/).pop();
  return last !== undefined && last.length > 0 ? last : path;
}

/**
 * Choix d'une texture par VIGNETTE, pour le paramètre qu'un effet déclare via
 * `EffectModule.libraryTexture`.
 *
 * POURQUOI PAS UN CURSEUR, NI UNE LISTE `choices`. La valeur reste un nombre —
 * l'uniform est un `array<f32>` et rien d'autre ne franchit cette frontière —
 * mais un curseur afficherait « 3 » sans dire de quelle matière il s'agit, et
 * `choices` demande une liste STATIQUE alors que le catalogue dépend du dossier
 * choisi. Une texture se reconnaît en la voyant : c'est le seul contrôle qui
 * dise ce qu'il désigne.
 *
 * Purement présentationnel — il ne connaît ni la bibliothèque ni le renderer,
 * tout arrive par les props (frontière `ARCHITECTURE.md`).
 */
export function TexturePicker({
  label,
  files,
  thumbnails,
  value,
  disabled,
  onChange,
  onRequestThumbnail,
}: TexturePickerProps) {
  const gridRef = useRef<HTMLUListElement>(null);

  // Chargement PARESSEUX, même raison que dans la carte du dock : un dossier de
  // scans 8K ne se décode pas d'un bloc pour remplir une grille dont on ne voit
  // qu'une poignée de cases.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    if (typeof IntersectionObserver === "undefined") {
      for (const path of files) onRequestThumbnail(path);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const path = (entry.target as HTMLElement).dataset.path;
          if (path !== undefined) onRequestThumbnail(path);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    for (const cell of grid.querySelectorAll<HTMLElement>("[data-path]")) observer.observe(cell);
    return () => observer.disconnect();
  }, [files, onRequestThumbnail]);

  if (files.length === 0) {
    return (
      <div className="texture-picker">
        <span className="texture-picker__label">{label}</span>
        <p className="texture-picker__empty">
          Aucune texture. Choisis un dossier dans la carte Textures.
        </p>
      </div>
    );
  }

  return (
    <div className="texture-picker">
      <div className="texture-picker__head">
        <span className="texture-picker__label">{label}</span>
        <span className="texture-picker__current">
          {/* Le NOM de la texture courante, pas son rang : c'est ce que
              l'utilisateur reconnaît. Un rang hors catalogue le dit au lieu
              d'afficher un vide qui se lirait comme « aucune ». */}
          {files[value] === undefined ? "hors catalogue" : fileName(files[value])}
        </span>
      </div>
      <ul ref={gridRef} className="texture-picker__grid">
        {files.map((path, index) => {
          const thumb = thumbnails.get(path) ?? null;
          const selected = index === value;
          return (
            <li key={path} data-path={path}>
              <button
                type="button"
                className={`texture-picker__cell${selected ? " texture-picker__cell--selected" : ""}`}
                aria-pressed={selected}
                disabled={disabled}
                title={fileName(path)}
                onClick={() => onChange(index)}
              >
                {thumb?.url != null && (
                  // `alt` vide : le nom est déjà dans le `title` du bouton, le
                  // répéter ferait lire deux fois la même chose.
                  <img className="texture-picker__image" src={thumb.url} alt="" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
