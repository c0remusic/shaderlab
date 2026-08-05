import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTextureDir, getTextureThumbnail, listTextureFiles, pickTextureFolder } from "../launch";
import { messageFromUnknown } from "../lib/errors";
import { TextureThumbnailCache, type TextureThumbnail } from "../textures/thumbnailCache";

/** Clé du dossier retenu entre deux lancements. `localStorage` et pas un
 *  fichier de config : c'est le seul store que le frontend écrit sans nouvelle
 *  commande Rust, et le journal d'erreurs GPU (`launch.ts`) l'utilise déjà pour
 *  la même raison. */
export const TEXTURE_DIR_STORAGE_KEY = "shaderlab.texture-dir";

function readStoredDir(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(TEXTURE_DIR_STORAGE_KEY);
  } catch {
    // Stockage refusé : on repart du dossier livré, ce n'est pas une erreur à
    // montrer — l'utilisateur n'a rien demandé de particulier au démarrage.
    return null;
  }
}

function storeDir(dir: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TEXTURE_DIR_STORAGE_KEY, dir);
  } catch (e) {
    console.warn("Dossier de textures non mémorisé :", e);
  }
}

/**
 * État de la bibliothèque de textures : quel dossier, quels fichiers, quelles
 * vignettes.
 *
 * Hook et pas composant — `ARCHITECTURE.md` : « `components/` ne contient
 * aucune logique métier », et §7 R6 « chaque feature apporte son propre hook
 * module ». `TextureLibrary` reste purement présentationnel, comme
 * `PresetPanel` en face de `usePresets`.
 *
 * DEUX DOSSIERS POSSIBLES, résolus dans cet ordre au montage :
 * 1. celui que l'utilisateur a désigné la dernière fois (`localStorage`) ;
 * 2. celui livré avec l'application (`defaultTextureDir`).
 *
 * C'est cette chaîne qui répond à « des textures déjà chargées » : rien à
 * cliquer au lancement, ni la première fois (dossier livré) ni les suivantes
 * (dossier retenu).
 */
export function useTextureLibrary() {
  const [dir, setDir] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, TextureThumbnail>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<TextureThumbnailCache | null>(null);
  const requestedRef = useRef<Set<string>>(new Set());

  // Un cache PAR DOSSIER : changer de dossier révoque toutes les object URL du
  // précédent. Sans ça, chaque navigation laisserait fuiter un blob par
  // vignette pour la durée de vie de la page — même discipline que
  // `PhotoSourceStore.dispose`.
  //
  // Cet effet ne fait QUE libérer. Le cache naît à la demande (`currentCache`)
  // et non ici, pour deux raisons distinctes qui pointent dans le même sens :
  // React 19 en `StrictMode` monte, démonte puis remonte chaque effet en dev —
  // un cache né dans un effet serait détruit par ce faux démontage alors que
  // l'état React, lui, survit ; et les effets d'un ENFANT tournent avant ceux
  // du parent, donc la grille de `TextureLibrary` peut demander une vignette
  // avant que cet effet-ci ait eu la main.
  useEffect(
    () => () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;
      requestedRef.current = new Set();
    },
    [dir],
  );

  /** Cache courant, créé à la première demande. Voir l'effet ci-dessus. */
  const currentCache = useCallback((): TextureThumbnailCache => {
    cacheRef.current ??= new TextureThumbnailCache({ getThumbnail: getTextureThumbnail });
    return cacheRef.current;
  }, []);

  /** Bascule vers un dossier DÉJÀ listé. Appelée hors corps d'effet — un
   *  `setState` synchrone dans un effet déclenche des rendus en cascade, et
   *  ces quatre-là partent ensemble ou pas du tout : garder les vignettes du
   *  dossier précédent afficherait des aperçus dont les object URL viennent
   *  d'être révoquées. */
  const applyDir = useCallback((next: string, list: string[]) => {
    cacheRef.current?.dispose();
    cacheRef.current = null;
    requestedRef.current = new Set();
    setThumbnails(new Map());
    setDir(next);
    setFiles(list);
    setError(null);
  }, []);

  const openDir = useCallback(
    async (next: string): Promise<boolean> => {
      try {
        const list = await listTextureFiles(next);
        applyDir(next, list);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    },
    [applyDir],
  );

  // Résolution au montage. Les échecs sont AVALÉS ici, et c'est délibéré :
  // un chemin mémorisé peut ne plus exister (disque externe débranché, dossier
  // renommé), et ce n'est pas une erreur à afficher au démarrage — c'est une
  // raison d'essayer le candidat suivant. Un échec des DEUX candidats laisse
  // simplement `dir` à `null`, et le panneau invite à en désigner un.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const candidates = [readStoredDir()];
      try {
        candidates.push(await defaultTextureDir());
      } catch {
        // La commande elle-même a échoué : il reste le dossier mémorisé.
      }
      for (const candidate of candidates) {
        if (cancelled) return;
        if (candidate === null) continue;
        try {
          const list = await listTextureFiles(candidate);
          if (cancelled) return;
          applyDir(candidate, list);
          return;
        } catch {
          continue;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDir]);

  /** Dialogue natif, puis ouverture. Le dossier n'est MÉMORISÉ que s'il a pu
   *  être listé : retenir un dossier illisible ferait échouer le prochain
   *  lancement au même endroit. */
  const pickFolder = useCallback(async () => {
    const picked = await pickTextureFolder();
    if (picked === null) return;
    if (await openDir(picked)) storeDir(picked);
  }, [openDir]);

  /** Demande la vignette d'un chemin. Appelée par la grille quand une cellule
   *  entre dans le champ de vision — jamais pour tout le dossier d'un coup :
   *  83 fichiers 8K représentent ~1,6 Go à faire transiter par l'IPC, pour
   *  afficher une douzaine de cases. */
  const requestThumbnail = useCallback((path: string) => {
    if (requestedRef.current.has(path)) return;
    requestedRef.current.add(path);
    const cache = currentCache();
    void cache.load(path).then((entry) => {
      // Le dossier a pu changer pendant le décodage : le cache courant n'est
      // alors plus celui qui a produit cette entrée, et l'écrire mélangerait
      // les vignettes de deux dossiers.
      if (cacheRef.current !== cache) return;
      setThumbnails((prev) => {
        const next = new Map(prev);
        next.set(path, entry);
        return next;
      });
    });
  }, [currentCache]);

  return { dir, files, thumbnails, error, pickFolder, requestThumbnail };
}
