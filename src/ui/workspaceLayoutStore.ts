import { migrateDockLayout, type DockLayout } from "./dockLayout";
import { readWorkspaceLayout, writeWorkspaceLayout } from "../launch";

/**
 * Persistance de la DISPOSITION DE L'ESPACE DE TRAVAIL — colonnes du dock,
 * groupes d'onglets, onglet actif, repli, largeur de colonne.
 *
 * Pourquoi ce module existe. `migrateDockLayout` était écrit, testé dix fois,
 * et sa doc affirmait que « la disposition est PERSISTÉE ». Elle ne l'était
 * pas : `dockLayout` et `dockWidth` vivaient dans un `useState`, donc le dock
 * repartait au défaut à chaque lancement, et la fonction n'avait AUCUN appelant
 * — elle et ses tests se validaient mutuellement, hors de tout chemin vivant.
 * Arbitrage d'Antoine le 2026-09-15 : construire la persistance plutôt que
 * retirer la fonction. Elle devient vraie ici.
 *
 * Il suit le patron de persistance déclaré du dépôt (`export/exportImage.ts`) :
 * un PORT étroit, une implémentation de production et une en mémoire, pour que
 * la logique de lecture — qui est toute la substance — s'éprouve sans Tauri.
 * Deux adaptateurs, donc un seam réel et pas hypothétique.
 *
 * ⚠️ Ce n'est PAS de l'état de document : ni historique, ni annulation, ni
 * preset. Arranger son espace de travail n'est pas éditer une image.
 */

/** Version du FORMAT sur disque, pas de l'application. Elle n'est pas là pour
 *  refuser un ancien fichier — `migrateDockLayout` sait déjà lire l'ancienne
 *  forme `string[][]` d'avant le 2026-08-19 — mais pour que le jour où une
 *  migration ne peut PAS se deviner du contenu, on sache de quoi on part. */
export const WORKSPACE_LAYOUT_VERSION = 1;

/** Délai de coalescing avant d'écrire la disposition, en millisecondes.
 *
 *  Il n'est pas là pour économiser des écritures en général mais pour UN geste
 *  précis : redimensionner la colonne appelle `onWidthChange` à chaque
 *  `pointermove`, donc sans délai un seul glissement produirait des dizaines
 *  d'écritures atomiques — fichier temporaire plus rename à chaque fois.
 *
 *  400 ms : assez long pour qu'un glissement entier tienne dans une écriture,
 *  assez court pour qu'un arrangement suivi d'une fermeture immédiate de la
 *  fenêtre soit enregistré. */
export const ECRITURE_DISPOSITION_MS = 400;

export interface WorkspaceLayout {
  dock: DockLayout;
  dockWidth: number;
}

/** Port de persistance. `read` rend `null` quand rien n'a été enregistré (le
 *  premier lancement) ; une lecture qui ÉCHOUE lève, elle ne rend pas `null`. */
export interface WorkspaceLayoutStore {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export const tauriWorkspaceLayoutStore: WorkspaceLayoutStore = {
  read: readWorkspaceLayout,
  write: writeWorkspaceLayout,
};

/** Double de test, et le SECOND adaptateur qui rend ce seam réel. */
export function inMemoryWorkspaceLayoutStore(initial: string | null = null): WorkspaceLayoutStore & {
  contents: string | null;
} {
  const store = {
    contents: initial,
    async read() {
      return store.contents;
    },
    async write(contents: string) {
      store.contents = contents;
    },
  };
  return store;
}

export function serializeWorkspaceLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({
    version: WORKSPACE_LAYOUT_VERSION,
    dock: layout.dock,
    dockWidth: layout.dockWidth,
  });
}

/**
 * Lit une disposition enregistrée, ou rend `null` si rien d'exploitable n'en
 * sort.
 *
 * TOUT ce qui ne se lit pas rend `null`, et l'appelant retombe sur sa
 * disposition d'usine : JSON invalide, forme inattendue, dock vide, largeur
 * absurde. Ce n'est pas un fallback silencieux au sens que le dépôt proscrit —
 * une disposition d'interface n'a pas de valeur de vérité à protéger, et
 * refuser de démarrer parce qu'un fichier de confort est corrompu serait un
 * bien pire défaut. Ce qui reste fail-fast, en revanche, c'est la lecture
 * elle-même : un fichier présent et illisible LÈVE depuis le Rust.
 *
 * `dock` passe par `migrateDockLayout`, qui lit les deux formes et REVALIDE
 * l'onglet actif — une disposition citant un onglet absent de son groupe ne
 * rendrait aucun contenu, donc une carte vide sans erreur nulle part.
 */
export function parseWorkspaceLayout(raw: string, clampWidth: (w: number) => number): WorkspaceLayout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const doc = parsed as { dock?: unknown; dockWidth?: unknown };

  const dock = migrateDockLayout(doc.dock);
  // Un dock VIDE est rejeté comme une forme illisible : il ne peut pas être le
  // résultat d'un arrangement volontaire — masquer tous les panneaux se fait
  // par `visibleDockLayout`, qui ne touche pas à la disposition enregistrée.
  if (dock === null || dock.length === 0) return null;

  const width = typeof doc.dockWidth === "number" && Number.isFinite(doc.dockWidth)
    ? clampWidth(doc.dockWidth)
    : null;
  if (width === null) return null;

  return { dock, dockWidth: width };
}

/** Charge la disposition enregistrée, ou `null`. Ne lève jamais sur un contenu
 *  illisible ; laisse remonter un échec de LECTURE, qui est un incident. */
export async function loadWorkspaceLayout(
  store: WorkspaceLayoutStore,
  clampWidth: (w: number) => number,
): Promise<WorkspaceLayout | null> {
  const raw = await store.read();
  if (raw === null) return null;
  return parseWorkspaceLayout(raw, clampWidth);
}
