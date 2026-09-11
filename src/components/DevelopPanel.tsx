import type { LayerState } from "../layers/types";
import type { DevelopSettings } from "../layers/developSettings";
import { defaultLayerMask } from "../mask/types";
import { developDisplayOrder, isDevelopModuleAtDefault } from "../render/developRegistry";
import { ParamPanel } from "./ParamPanel";
import { Button } from "./ui/button";
import { RotateCcw } from "lucide-react";
import "./DevelopPanel.css";

/**
 * La carte « Développement » de la colonne de droite (ticket 03 lightroom-develop).
 *
 * C'est l'ÉTAGE de développement du document, PAS un calque : ses réglages
 * s'appliquent au composite de toute la pile, en fin de chaîne. Le panneau est
 * VISIBLE dès qu'une image est ouverte, sans calque sélectionné — c'est le point
 * d'entrée d'un utilisateur Lightroom qui ouvre une photo.
 *
 * ⚠️ IL NE FOURCHE PAS `ParamPanel`. Chaque module de l'étage est un
 * `EffectModule` (mêmes sections, mêmes contrôles) : on nourrit `ParamPanel` d'un
 * calque SYNTHÉTIQUE dont l'`effectId` est l'id du module — que `getEffect`
 * résout (comme `passthrough`), et dont les `params` sont les valeurs de
 * `DevelopSettings[moduleId]`. `ParamPanel` interroge le contrat déclaratif du
 * module, jamais son identité (frontière d'`ARCHITECTURE.md`), donc il rend un
 * module de l'étage exactement comme un effet de calque, sans le savoir. Le
 * `layer.id` synthétique remonte dans `onParamChange` mais on l'ignore : le
 * `moduleId` est capturé dans la fermeture.
 *
 * L'ordre des panneaux est celui de l'AFFICHAGE de Lightroom
 * (`developDisplayOrder`), qui n'est pas l'ordre d'application.
 */
interface Props {
  /** Réglages courants de l'étage (source : `LayerStack.develop`, projeté). */
  develop: DevelopSettings;
  /** Une image est-elle ouverte ? Sinon, la carte montre un état d'accueil. */
  hasImage: boolean;
  /** Patch VIVANT d'un module (un ou quelques paramètres). Voie vivante côté
   *  App (`replaceLiveDevelop` + `requestRender`). */
  onDevelopChange: (moduleId: string, patch: Record<string, number>) => void;
  /** Fin d'interaction d'un curseur : commit (le même point que tous les
   *  curseurs vivants du document). */
  onDevelopCommit: () => void;
  /** « Réinitialiser » un module : ses valeurs retournent au défaut, un pas
   *  d'undo. */
  onDevelopReset: (moduleId: string) => void;
}

/** Calque SYNTHÉTIQUE pour nourrir `ParamPanel` sans le forker. `effectId` =
 *  l'id du module, résolu par `getEffect`. */
function developLayer(moduleId: string, values: Record<string, number> | undefined): LayerState {
  return {
    id: `develop:${moduleId}`,
    effectId: moduleId,
    params: values ?? {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

export function DevelopPanel({ develop, hasImage, onDevelopChange, onDevelopCommit, onDevelopReset }: Props) {
  if (!hasImage) {
    return <p className="develop-panel__empty">Ouvre une image pour la développer.</p>;
  }
  return (
    <div className="develop-panel">
      {developDisplayOrder.map((module) => {
        const values = develop[module.id];
        const atDefault = isDevelopModuleAtDefault(module, values);
        return (
          <section className="develop-panel__module" key={module.id}>
            <header className="develop-panel__module-header">
              <span className="develop-panel__module-name">{module.name}</span>
              <Button
                size="sm"
                variant="ghost"
                // Désactivé quand le module est déjà au défaut : réinitialiser
                // n'aurait rien à défaire (no-op côté App, mais l'inertie doit se
                // VOIR — un bouton actif qui ne fait rien est l'échec silencieux
                // que ce dépôt proscrit).
                disabled={atDefault}
                onClick={() => onDevelopReset(module.id)}
                title="Réinitialiser ce module au défaut"
              >
                <RotateCcw className="icon-sm icon-stroke" aria-hidden="true" />
                Réinitialiser
              </Button>
            </header>
            <ParamPanel
              layer={developLayer(module.id, values)}
              onParamChange={(_id, patch) => onDevelopChange(module.id, patch)}
              onParamCommit={onDevelopCommit}
              // L'étalonnage n'a aucun `colorGroup`, donc ce rappel n'est jamais
              // appelé ; un module futur de l'étage qui en porterait exigerait de
              // remonter le sélecteur de couleur ici, comme la carte Propriétés.
              onOpenColorPicker={() => {}}
            />
          </section>
        );
      })}
    </div>
  );
}
