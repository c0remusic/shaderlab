import { Button } from "./ui/button";
import { Dialog } from "../ui/Dialog";
import { applyPresetImpactMessage } from "../presets/applyPresetImpact";
import type { usePresetWorkflow } from "../hooks/usePresetWorkflow";

/**
 * Les quatre dialogues modaux du parcours PRESET, extraits d'`App.tsx` le
 * 2026-08-01 (item A1 du backlog de remédiation : le fichier était à 2167
 * lignes, contre 1823 annoncées la veille).
 *
 * POURQUOI CEUX-LÀ EN PREMIER. Ce sont 190 lignes de JSX qui ne décident RIEN :
 * chaque bouton appelle un rappel qu'`App.tsx` lui donne. Les déplacer ne
 * touche donc pas à la frontière que ce dossier tient — « `components/` ne
 * contient aucune logique métier, tous les handlers viennent d'`App.tsx` »
 * (CLAUDE.md § Architecture). C'est le découpage le moins risqué du fichier, et
 * c'est aussi le plus gros bloc d'un seul tenant.
 *
 * AUCUNE FERMETURE N'A SUIVI. Le JSX d'origine portait ses décisions en ligne
 * (`pendingOverwrite?.resolve(false)`, `gateOnPhotoLayers(name, () =>
 * commitSavePreset(name, id)).then(resolve)`). Les recopier ici aurait fait
 * traverser la frontière à de la logique de workflow sous couvert de
 * déménagement. Chaque dialogue reçoit donc des rappels DÉJÀ fermés sur leur
 * état, et ce composant ne connaît ni `usePresetWorkflow`, ni la session, ni
 * les presets — il ne sait que ce qu'il doit afficher et quel rappel appeler.
 *
 * Les TYPES des états en attente sont dérivés du hook (`ReturnType`) plutôt que
 * redéclarés : un type recopié aurait dérivé, et une divergence entre les deux
 * ne se serait vue qu'au moment où un champ manque à l'exécution.
 */

type PresetWorkflow = ReturnType<typeof usePresetWorkflow>;

export interface PresetDialogsProps {
  /** Collision de nom à l'enregistrement (porte C1). */
  pendingOverwrite: PresetWorkflow["pendingOverwrite"];
  onOverwriteCancel: () => void;
  onOverwriteConfirm: () => void;

  /** Avis d'exclusion des calques photo (porte bloquante, design §9). */
  pendingPhotoLayerSave: PresetWorkflow["pendingPhotoLayerSave"];
  onPhotoLayerSaveCancel: () => void;
  onPhotoLayerSaveConfirm: () => void;

  /** Saisie du nom pour « Créer une copie ». */
  pendingCopyName: string | null;
  onCopyNameChange: (name: string) => void;
  onCopyCancel: () => void;
  onCopyConfirm: () => void;

  /** Confirmation avant d'appliquer un preset sur une pile non vide. */
  pendingApply: { id: string; photoLayerCount: number; lockedEffectCount: number } | null;
  onApplyCancel: () => void;
  onApplyConfirm: () => void;
}

export function PresetDialogs({
  pendingOverwrite,
  onOverwriteCancel,
  onOverwriteConfirm,
  pendingPhotoLayerSave,
  onPhotoLayerSaveCancel,
  onPhotoLayerSaveConfirm,
  pendingCopyName,
  onCopyNameChange,
  onCopyCancel,
  onCopyConfirm,
  pendingApply,
  onApplyCancel,
  onApplyConfirm,
}: PresetDialogsProps) {
  return (
    <>
      <Dialog
        open={pendingOverwrite !== null}
        title="Remplacer le preset existant ?"
        description={pendingOverwrite ? `Un preset nommé "${pendingOverwrite.name}" existe déjà. L'enregistrement va écraser son contenu.` : undefined}
        // Mineur 4 : annuler l'écrasement (X / Échap) doit résoudre
        // `requestSavePreset` à `false` — sinon la Promise reste en suspens et
        // PresetPanel ne sait jamais que l'écriture n'a pas eu lieu. C'est
        // `onOverwriteCancel` qui porte cette résolution, pas ce composant.
        onClose={onOverwriteCancel}
        actions={
          <>
            <Button
              variant="secondary"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dialogue MODAL : le focus doit entrer dans le dialogue a son ouverture, et il est pose sur l'action SANS effet (Annuler), jamais sur l'action destructrice. C'est le comportement attendu d'une boite de dialogue, pas un vol de focus sur une page.
              autoFocus
              onClick={onOverwriteCancel}
            >
              Annuler
            </Button>
            <Button variant="destructive" onClick={onOverwriteConfirm}>
              Écraser
            </Button>
          </>
        }
      />
      <Dialog
        open={pendingPhotoLayerSave !== null}
        title="Calque(s) photo exclu(s) du preset"
        description={
          pendingPhotoLayerSave
            ? // « photo », plus « photo (double exposure) » : depuis T1 la
              // photo d'ouverture est un calque photo comme un autre et peut
              // figurer dans cette liste — la nommer « double exposure »
              // serait faux. L'avis lui-même ne se déclenche plus que si le
              // document contient une photo IMPORTÉE (presetDocument.ts).
              `${pendingPhotoLayerSave.excludedLayerIndexes.length} calque${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "s" : ""} photo ne ${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "seront" : "sera"} pas inclus dans le preset — une source de photo n'a de sens que dans ce document.`
            : undefined
        }
        onClose={onPhotoLayerSaveCancel}
        actions={
          <>
            <Button
              variant="secondary"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dialogue MODAL, focus sur l'action sans effet (Annuler) : voir la meme note sur le dialogue « Remplacer ? ».
              autoFocus
              onClick={onPhotoLayerSaveCancel}
            >
              Annuler
            </Button>
            <Button variant="default" onClick={onPhotoLayerSaveConfirm}>
              Enregistrer quand même
            </Button>
          </>
        }
      >
        {pendingPhotoLayerSave && (
          <ul className="preset-panel__excluded-list">
            {pendingPhotoLayerSave.excludedLayerIndexes.map((layerIndex) => (
              <li key={layerIndex}>Calque {layerIndex + 1} — photo</li>
            ))}
          </ul>
        )}
      </Dialog>
      <Dialog
        open={pendingCopyName !== null}
        title="Créer une copie du preset"
        onClose={onCopyCancel}
        actions={
          <>
            <Button
              variant="secondary"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dialogue MODAL, focus sur l'action sans effet (Annuler) : voir la meme note sur le dialogue « Remplacer ? ».
              autoFocus
              onClick={onCopyCancel}
            >
              Annuler
            </Button>
            <Button
              variant="default"
              disabled={!pendingCopyName || pendingCopyName.trim() === ""}
              onClick={onCopyConfirm}
            >
              Créer
            </Button>
          </>
        }
      >
        {/* `aria-label` et pas seulement le `placeholder` : un placeholder
            n'est qu'un nom accessible de DERNIER recours (HTML-AAM), et son
            jumeau de `PresetPanel` porte déjà l'attribut. Deux champs du même
            rôle nommés par deux mécanismes différents est une dérive, pas un
            choix. Relevé le 2026-07-30 en balayant les noms accessibles des
            contrôles du dock. */}
        <input
          type="text"
          className="preset-panel__name-input"
          aria-label="Nom de la copie du preset"
          placeholder="Nom du nouveau preset"
          value={pendingCopyName ?? ""}
          onChange={(e) => onCopyNameChange(e.target.value)}
        />
      </Dialog>
      <Dialog
        open={pendingApply !== null}
        title="Remplacer la pile de calques ?"
        description={
          // T5 (2026-07-28) : cette phrase annonçait la perte des calques
          // photo. C'était vrai quand `applyPreset` remplaçait la pile
          // entière ; c'est FAUX depuis que T1 les préserve
          // (`withPhotoLayersPreserved`). Elle vit maintenant dans une
          // fonction testée — voir `presets/applyPresetImpact.ts` pour
          // pourquoi une fausse menace est aussi grave qu'un avis parasite.
          pendingApply ? applyPresetImpactMessage(pendingApply.photoLayerCount, pendingApply.lockedEffectCount) : undefined
        }
        onClose={onApplyCancel}
        actions={
          <>
            <Button
              variant="secondary"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dialogue MODAL, focus sur l'action sans effet (Annuler) : voir la meme note sur le dialogue « Remplacer ? ».
              autoFocus
              onClick={onApplyCancel}
            >
              Annuler
            </Button>
            <Button variant="destructive" onClick={onApplyConfirm}>
              Remplacer
            </Button>
          </>
        }
      />
    </>
  );
}
