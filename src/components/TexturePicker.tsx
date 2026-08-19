import { useEffect, useRef } from "react";
import type { TextureThumbnail } from "../textures/thumbnailCache";
import { Button } from "./ui/button";
import "./TexturePicker.css";

export interface TexturePickerProps {
  label: string;
  /** Dossier courant, ou `null` si aucun n'a pu être résolu.
   *
   *  Arrivé ici le 2026-08-19 avec `onPickFolder`, en même temps que la carte
   *  « Textures » du dock partait : le choix du dossier ne vivait QUE sur elle,
   *  et ce picker serait resté figé sur le dossier livré. */
  dir: string | null;
  /** Chemins ABSOLUS, triés — le catalogue de la bibliothèque. L'INDEX dans ce
   *  tableau EST la valeur du paramètre (`EffectModule.libraryTexture`). */
  files: readonly string[];
  thumbnails: ReadonlyMap<string, TextureThumbnail>;
  /** Erreur de la bibliothèque (dossier illisible, listing refusé). Montrée
   *  ici pour la même raison que `dir` : plus aucune autre surface ne la dit. */
  error: string | null;
  onPickFolder: () => void;
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
  dir,
  files,
  thumbnails,
  error,
  value,
  disabled,
  onChange,
  onPickFolder,
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

  /* Le bouton de dossier est le MÊME dans les deux branches, vide ou non : il
     agit sur la bibliothèque entière et pas sur une texture, donc il ne peut
     pas disparaître avec la grille — sans lui un dossier vide serait sans
     issue. C'est la zone de contrôles unique d'ADR-0001, réduite à un bouton. */
  const boutonDossier = (
    <Button variant="secondary" size="sm" disabled={disabled} onClick={onPickFolder}>
      Dossier…
    </Button>
  );

  if (files.length === 0) {
    return (
      <div className="texture-picker">
        <div className="texture-picker__head">
          <span className="texture-picker__label">{label}</span>
          {boutonDossier}
        </div>
        {error !== null && <p className="texture-picker__error">{error}</p>}
        <p className="texture-picker__empty">
          {dir === null
            ? "Aucun dossier de textures. Choisis-en un : scans de papier, grain, rayures, matières."
            : "Ce dossier ne contient aucune image (JPEG ou PNG, sous-dossiers compris)."}
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
        {boutonDossier}
      </div>
      {error !== null && <p className="texture-picker__error">{error}</p>}
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
