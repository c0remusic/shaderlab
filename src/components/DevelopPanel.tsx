import type { LayerState } from "../layers/types";
import { isDevelopModuleEnabled, type DevelopSettings } from "../layers/developSettings";
import { defaultLayerMask } from "../mask/types";
import { developDisplayOrder } from "../render/developRegistry";
import { ParamPanel } from "./ParamPanel";
import { ColorMixer } from "./ColorMixer";
import { Disclosure } from "./ui/collapsible";
import { IconButton } from "./ui/icon-button";
import { Toggle } from "./ui/toggle";
import { Eye, EyeOff } from "lucide-react";
import "./DevelopPanel.css";

/**
 * La carte « Développement » de la colonne de droite (tickets 03 et 07
 * lightroom-develop).
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
 * module, jamais son identité (frontière d'`ARCHITECTURE.md`). La prop
 * `develop` lui fait rendre ses contrôles à la manière de Lightroom (curseurs
 * inline signés, sous-titres centrés) — de l'AFFICHAGE, aucun index ne bouge.
 *
 * L'ordre des panneaux est celui de l'AFFICHAGE de Lightroom
 * (`developDisplayOrder`), qui n'est pas l'ordre d'application.
 *
 * ⚠️ CHAQUE MODULE EST UN ACCORDÉON À LA LIGHTROOM (ticket 07) : en-tête pleine
 * largeur, TITRE À DROITE, chevron de repli, et un INTERRUPTEUR (œil) à GAUCHE
 * qui active/désactive le module sans perdre ses valeurs (`isDevelopModuleEnabled`
 * dans `DevelopSettings` ; un module éteint est SAUTÉ par l'étage comme au
 * défaut). La CARTE de dock borne sa hauteur et défile DEDANS (`overflow-y:auto`,
 * ADR-0001 : la colonne ne défile jamais). Le pied « Réinitialiser » de l'étage
 * vit dans le slot `controls` de la carte (`App.tsx`, `controlsPlacement:
 * "bottom"`), fixe et hors du défilement — pas dans ce composant.
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
  /** Bascule l'INTERRUPTEUR (œil) d'un module : actif ↔ inactif, un pas d'undo.
   *  Un module inactif garde ses valeurs mais n'est pas appliqué. */
  onDevelopToggleEnabled: (moduleId: string) => void;
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

export function DevelopPanel({ develop, hasImage, onDevelopChange, onDevelopCommit, onDevelopToggleEnabled }: Props) {
  if (!hasImage) {
    return <p className="develop-panel__empty">Ouvre une image pour la développer.</p>;
  }
  // Le mode Noir et blanc est porté par le module HSL (`hsl.mode`), mais son
  // interrupteur vit — comme chez Lightroom — dans le bandeau des Réglages de
  // base. Basculer le bouton N&B change ce paramètre du module HSL.
  const bwOn = (develop.hsl?.mode ?? 0) === 1;
  return (
    <div className="develop-panel">
      {developDisplayOrder.map((module) => {
        const values = develop[module.id];
        const enabled = isDevelopModuleEnabled(develop, module.id);
        return (
          <section className="develop-panel__module" key={module.id} data-module-disabled={!enabled || undefined}>
            <Disclosure
              title={module.name}
              defaultOpen
              align="end"
              leading={
                <IconButton
                  label={enabled ? "Désactiver ce module" : "Activer ce module"}
                  size="compact"
                  aria-pressed={enabled}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDevelopToggleEnabled(module.id);
                  }}
                >
                  {enabled ? (
                    <Eye className="icon-sm icon-stroke" aria-hidden="true" />
                  ) : (
                    <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
                  )}
                </IconButton>
              }
            >
              {module.id === "reglagesDeBase" && (
                // BANDEAU LIGHTROOM. Chez Lightroom : Auto · N&B · HDR, plus
                // Profil et la pipette de balance des blancs. Chez nous, SEUL
                // N&B : Auto exigerait une analyse d'image (hors périmètre), HDR
                // et le Profil un pipeline flottant/RAW qu'on n'a pas, et la
                // pipette n'a pas de sens en balance des blancs RELATIVE sur du
                // JPEG (voir README de `lightroom-develop`). N&B bascule le mode
                // du module HSL et le reflète.
                <div className="develop-panel__banner">
                  <Toggle
                    size="sm"
                    variant="outline"
                    pressed={bwOn}
                    onPressedChange={() => {
                      onDevelopChange("hsl", { mode: bwOn ? 0 : 1 });
                      onDevelopCommit();
                    }}
                  >
                    N&amp;B
                  </Toggle>
                </div>
              )}
              {module.id === "hsl" ? (
                // MÉLANGEUR EN DEUX VUES (ticket 07, item 5). Seul module de
                // l'étage à porter un sélecteur au-dessus de ses curseurs, parce
                // qu'il est le seul dont les paramètres aient DEUX axes de
                // lecture (huit bandes × trois canaux). `ColorMixer` ne fabrique
                // que ce sélecteur : les curseurs restent ceux de `ParamPanel`.
                <ColorMixer
                  layer={developLayer(module.id, values)}
                  onParamChange={(_id, patch) => onDevelopChange(module.id, patch)}
                  onParamCommit={onDevelopCommit}
                />
              ) : (
                <ParamPanel
                  layer={developLayer(module.id, values)}
                  onParamChange={(_id, patch) => onDevelopChange(module.id, patch)}
                  onParamCommit={onDevelopCommit}
                  onOpenColorPicker={() => {}}
                  develop
                  flat
                />
              )}
            </Disclosure>
          </section>
        );
      })}
    </div>
  );
}
