import { useCallback, useState, type RefObject } from "react";
import type { DocumentSession } from "../application/documentSession";
import { capture } from "../presets/presetDocument";
import { messageFromUnknown } from "../lib/errors";
import type { usePresets } from "./usePresets";

interface Deps {
  sessionRef: RefObject<DocumentSession>;
  /** L'API rendue par `usePresets` — passée en BLOC, mais jamais utilisée
   *  comme dépendance en bloc : chaque `useCallback` ci-dessous dépend des
   *  membres qu'il appelle (`presets.overwrite`, `presets.save`, ...), pas de
   *  l'objet lui-même, qui est un littéral frais à chaque render. Même
   *  resserrement que celui déjà appliqué dans `App.tsx`. */
  presets: ReturnType<typeof usePresets>;
  setError: (message: string | null) => void;
}

/**
 * Le WORKFLOW d'écriture des presets : les deux portes de confirmation
 * (collision de nom, exclusion de calques photo) et les trois points d'entrée
 * utilisateur qui les traversent (« Enregistrer », « Mettre à jour »,
 * « Créer une copie »).
 *
 * Extrait d'`App.tsx` sur le modèle exact de `usePresets`/`usePhotoLayer`
 * (`ARCHITECTURE.md` §7 R6). RESTENT dans `App.tsx` : le JSX des `Dialog`
 * (c'est du rendu), l'APPLICATION d'un preset (`applyPreset`/
 * `requestApplyPreset` et son `pendingPresetApply`, qui touchent la pile de
 * calques et `maskPaintersRef`, pas l'écriture de fichiers), le
 * renommage, et l'import/export de fichier preset.
 *
 * L'état des dialogues vit ICI et non dans `App.tsx` parce que sa seule raison
 * d'exister est de suspendre l'une de ces écritures : `pendingOverwrite` et
 * `pendingPhotoLayerSave` portent la continuation de l'écriture en attente,
 * `pendingPresetCopyName` la saisie du seul appelant de
 * `requestCopyActiveAsNew`.
 */
export function usePresetWorkflow({ sessionRef, presets, setError }: Deps) {
  // Task 5 : nom en attente de saisie pour "Créer une copie" depuis la
  // bannière de dérive — non nul tant que le dialogue de nommage est ouvert.
  const [pendingPresetCopyName, setPendingPresetCopyName] = useState<string | null>(null);

  // Deux confirmations peuvent s'enchaîner sur un même enregistrement (C1
  // overwrite-by-name, puis exclusion de calque photo) — voir
  // requestSavePreset/gateOnPhotoLayers plus bas. `pendingPhotoLayerSave`
  // porte un `onConfirm` CALLBACK plutôt qu'un flag figé "overwrite ou pas" :
  // le Task 5 réutilise cette même porte pour "Mettre à jour"/"Créer une
  // copie", qui ne rentrent pas dans une forme overwrite-id mais ont besoin
  // du même contrat "confirmer, puis lancer cette écriture précise".
  // `resolve`/`onCancel` portent la résolution de la promesse rendue par
  // `requestSavePreset` (Mineur 4, revue tâche 3) : PresetPanel n'efface son
  // champ de saisie qu'une fois l'écriture réellement aboutie, jamais sur la
  // seule demande — donc chaque porte de confirmation doit savoir dire "annulé"
  // (false) aussi bien que "confirmé puis écrit" (true/false selon l'issue).
  const [pendingOverwrite, setPendingOverwrite] = useState<{ id: string; name: string; resolve: (written: boolean) => void } | null>(
    null
  );
  const [pendingPhotoLayerSave, setPendingPhotoLayerSave] = useState<{
    excludedLayerIndexes: number[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  /** Runs `capture(sessionRef.current.layers(), name)` purely to inspect
   *  `skipped` — if it reports any excluded photo layer, blocks on the
   *  `pendingPhotoLayerSave` Dialog and defers `onConfirmed` to its
   *  "Enregistrer quand même" button; otherwise runs `onConfirmed`
   *  immediately. `name` is only used to compute `skipped` (a photo-layer
   *  exclusion doesn't depend on the target name) — callers that don't have
   *  a natural "new name" yet (Task 5's `updateActive`) pass the CURRENT
   *  preset's existing name, which is what would be recaptured anyway.
   *  Rend `false` si l'utilisateur annule la porte (Mineur 4), sinon le
   *  résultat de `onConfirmed` (issue réelle de l'écriture). */
  const gateOnPhotoLayers = useCallback((name: string, onConfirmed: () => Promise<boolean>): Promise<boolean> => {
    const { skipped } = capture(sessionRef.current.layers(), name);
    const excludedLayerIndexes = skipped.filter((s) => s.reason === "photo-layer").map((s) => s.layerIndex);
    if (excludedLayerIndexes.length > 0) {
      return new Promise<boolean>((resolve) => {
        setPendingPhotoLayerSave({
          excludedLayerIndexes,
          onConfirm: () => {
            onConfirmed().then(resolve);
          },
          onCancel: () => resolve(false),
        });
      });
    }
    return onConfirmed();
    // `sessionRef` est un objet de ref (identite stable par construction) : le
    // declarer ici satisfait la regle sans rien changer a la frequence de
    // recreation de ce callback.
  }, [sessionRef]);

  const commitSavePreset = useCallback(async (name: string, overwriteId: string | null): Promise<boolean> => {
    try {
      if (overwriteId) {
        await presets.overwrite(overwriteId, sessionRef.current.layers(), name);
      } else {
        await presets.save(sessionRef.current.layers(), name);
      }
      return true;
    } catch (e) {
      setError(messageFromUnknown(e));
      return false;
    }
  }, [presets.overwrite, presets.save]);

  // ORDRE : `requestSavePreset` vient APRÈS les deux fonctions qu'elle appelle.
  // C'étaient des déclarations de fonction (hissées) ; en `useCallback` ce sont
  // des `const`, qui ne le sont pas — d'où ce déplacement, seul changement de
  // forme apporté à ce bloc.
  //
  // Mineur 4 (revue tâche 3) : rend une Promise<boolean> résolue à `true`
  // SEULEMENT si l'écriture a réellement abouti (aucune confirmation
  // annulée, aucune exception) — PresetPanel n'efface son champ de saisie
  // que sur `true`, jamais sur la seule demande d'enregistrement.
  const requestSavePreset = useCallback(async (name: string): Promise<boolean> => {
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, () => commitSavePreset(name, null));
  }, [presets.summaries, gateOnPhotoLayers, commitSavePreset]);

  /** "Mettre à jour" (dirty banner). Reuses the active preset's own current
   *  name — `updateActive` keeps the name unchanged, `capture()` only needs
   *  SOME name to run its exclusion check. Routes through the SAME
   *  `gateOnPhotoLayers` gate as `requestSavePreset` (a photo layer must
   *  never be silently dropped from a written preset file). */
  function requestUpdateActive() {
    if (!presets.activePresetId) return;
    const layers = sessionRef.current.layers();
    // Critique 1 (final-review fix): never write an EMPTY stack over a
    // preset file. Reachable via undo (see handleUndo/reconcileActive...)
    // only through a race between the reconciliation and this click — kept
    // as a second, independent guard rather than relying solely on
    // `reconcileActiveAfterHistoryChange` clearing `activePresetId` in time.
    // The banner itself is also gated on `layers.length > 0` (App.tsx's JSX),
    // so this button should already be unreachable when the stack is empty —
    // this is the belt to that suspenders.
    if (layers.length === 0) return;
    const activeSummary = presets.summaries.find((s) => s.id === presets.activePresetId);
    if (!activeSummary) {
      // Mineur (final-review fix): the old `?.name ?? ""` fallback let this
      // dialog open with an empty preset name on a lookup miss instead of
      // reporting the anomaly (activePresetId pointing at a preset removed
      // from the library, or summaries not yet refreshed) — fail loudly
      // rather than silently proceeding with a blank name.
      setError(`Preset actif introuvable dans la bibliothèque (id ${presets.activePresetId}) — impossible de le mettre à jour.`);
      return;
    }
    gateOnPhotoLayers(activeSummary.name, async () => {
      try {
        await presets.updateActive(layers);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  /** "Créer une copie" (dirty banner). Same photo-layer gate as
   *  `requestSavePreset`, AND now the same name-collision gate too
   *  (Important 3, final-review fix): before this fix, typing an
   *  already-taken name here created a silent duplicate — `requestSavePreset`
   *  asked to confirm an overwrite for the same event, `importFrom` instead
   *  auto-renamed to "(copie N)`, so the same feature had THREE different
   *  collision policies. Chosen here: reuse the SAME "Remplacer ?" dialog as
   *  `requestSavePreset` (not `resolveImportName`'s silent auto-rename) —
   *  unlike an import, the name here is something the user just TYPED
   *  themselves into a visible field, so a collision is very likely
   *  deliberate ("overwrite that one") and deserves the same explicit
   *  confirm/cancel as manual save, not a surprise "(copie 2)" they didn't
   *  ask for. */
  function requestCopyActiveAsNew(name: string): Promise<boolean> {
    const layers = sessionRef.current.layers();
    if (layers.length === 0) return Promise.resolve(false); // Critique 1 : jamais de preset vide
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, async () => {
      try {
        await presets.copyActiveAsNew(layers, name);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  return {
    gateOnPhotoLayers,
    commitSavePreset,
    requestSavePreset,
    requestUpdateActive,
    requestCopyActiveAsNew,
    pendingOverwrite,
    setPendingOverwrite,
    pendingPhotoLayerSave,
    setPendingPhotoLayerSave,
    pendingPresetCopyName,
    setPendingPresetCopyName,
  };
}
