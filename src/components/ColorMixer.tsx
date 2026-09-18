import { useState } from "react";
import type { LayerState } from "../layers/types";
import { HSL_BANDES, type HslBande } from "../render/effects/hslBandes";
import { hslBandeSwatch } from "../render/effects/trackGradients";
import { CANAUX, NOM_DE_BANDE, estNoirEtBlanc, rendreMixer, type MixerCanal, type MixerVue } from "../ui/colorMixer";
import { getEffect } from "../render/effects/registry";
import { ParamPanel } from "./ParamPanel";
import { Select } from "./ui/select";
import { Toggle } from "./ui/toggle";
import "./ColorMixer.css";

/**
 * LE MÉLANGEUR DE COULEURS EN DEUX VUES (ticket 07, item 5).
 *
 * ⚠️ IL NE FOURCHE NI `ParamPanel` NI AUCUN CURSEUR. Ce composant ne rend que
 * les DEUX SÉLECTEURS que Lightroom pose au-dessus du panneau — la vue, puis la
 * bande ou le canal — et délègue tout le reste à `ParamPanel`, à qui il passe un
 * REGROUPEMENT calculé par `src/ui/colorMixer.ts`. Les curseurs qui en sortent
 * sont ceux de partout ailleurs : valeur signée, double-clic de retour au
 * défaut, pistes colorées du ticket 08, même voie de commit.
 *
 * C'était la difficulté du ticket, et la raison pour laquelle il avait été
 * différé : « une présentation bespoke » se lit comme « écris une interface à
 * côté », alors que les deux vues de Lightroom sont le MÊME jeu de paramètres vu
 * selon deux axes. Une fois vue comme un regroupement, il ne reste qu'un
 * sélecteur à écrire.
 *
 * ⚠️ LA VUE N'EST PAS DE L'ÉTAT DE DOCUMENT. Choisir « Couleur » plutôt que
 * « Mélange » ne change pas l'image : ça ne va donc ni dans `DevelopSettings`,
 * ni dans l'historique, ni dans un preset. C'est un état local, perdu au
 * démontage — Lightroom le retient d'une session à l'autre, nous pas encore, et
 * ce serait une préférence d'interface, pas un réglage.
 *
 * ⚠️ EN NOIR ET BLANC, PAS DE SÉLECTEUR. Lightroom remplace alors le mélangeur
 * par le seul « Mélange noir et blanc » — il n'y a plus deux vues de couleur à
 * choisir. Les huit curseurs de mélange s'affichent donc nus, et la bascule qui
 * mène ici reste le bouton N&B du bandeau des Réglages de base.
 */
interface Props {
  /** Calque SYNTHÉTIQUE du module `hsl`, fabriqué par `DevelopPanel`. */
  layer: LayerState;
  /** Patch VIVANT d'un ou quelques paramètres du module. */
  onParamChange: (layerId: string, patch: Record<string, number>) => void;
  /** Fin d'interaction d'un curseur : commit. */
  onParamCommit: () => void;
}

export function ColorMixer({ layer, onParamChange, onParamCommit }: Props) {
  const [vue, setVue] = useState<MixerVue>("couleur");
  const [canal, setCanal] = useState<MixerCanal>("tout");
  const [bande, setBande] = useState<HslBande["id"]>("red");

  const noirEtBlanc = estNoirEtBlanc(layer.params);
  const presentation = rendreMixer({ vue, canal, bande, noirEtBlanc });

  // TRAITEMENT — le troisième sélecteur, et il est rendu ICI pour une raison de
  // PLACE. `mode` est le premier paramètre déclaré du module, donc `ParamPanel`
  // le rendait en tête : sous les pastilles, au-dessus des curseurs qu'elles
  // commandent, coupant le sélecteur de ce qu'il sélectionne. Il est masqué de
  // la présentation (`colorMixer.ts`) et posé avec ses pairs. Ce n'est pas un
  // contrôle de plus — le bouton N&B du bandeau des Réglages de base écrit le
  // même paramètre, et les deux restent d'accord parce qu'ils lisent la valeur
  // au lieu de tenir un état.
  const mode = getEffect(layer.effectId).params.find((p) => p.name === "mode");

  return (
    <div className="color-mixer">
      {mode?.choices && (
        <Select
          label={mode.label}
          labelPlacement="inline"
          value={String(noirEtBlanc ? 1 : 0)}
          options={mode.choices.map((label, index) => ({ value: String(index), label }))}
          onChange={(v) => {
            onParamChange(layer.id, { mode: Number(v) });
            onParamCommit();
          }}
        />
      )}
      {!noirEtBlanc && (
        <>
          <div className="color-mixer__vues">
            <span className="color-mixer__legende">Réglages :</span>
            <Toggle size="sm" variant="outline" pressed={vue === "couleur"} onPressedChange={() => setVue("couleur")}>
              Couleur
            </Toggle>
            <Toggle size="sm" variant="outline" pressed={vue === "melange"} onPressedChange={() => setVue("melange")}>
              Mélange
            </Toggle>
          </div>

          {vue === "couleur" ? (
            // LES HUIT PASTILLES. Ce sont des boutons de SÉLECTION, pas une
            // légende : chacune choisit la bande dont on règle les trois
            // curseurs. Le nom part en `aria-label` et en infobulle — huit noms
            // écrits sur 320 px de large tiendraient sur trois lignes, et la
            // couleur EST l'étiquette dans ce contrôle-là.
            <div className="color-mixer__pastilles" role="group" aria-label="Couleur à régler">
              {HSL_BANDES.map((b) => (
                <Toggle
                  key={b.id}
                  className="color-mixer__pastille"
                  size="sm"
                  pressed={bande === b.id}
                  onPressedChange={() => setBande(b.id)}
                  aria-label={NOM_DE_BANDE[b.id]}
                  title={NOM_DE_BANDE[b.id]}
                >
                  <span className="color-mixer__puce" style={{ background: hslBandeSwatch(b.id) }} aria-hidden="true" />
                </Toggle>
              ))}
            </div>
          ) : (
            // ⚠️ LES ONGLETS PORTENT UN `aria-label` PRÉFIXÉ, et ce n'est pas
            // du zèle : à « Tout », le bloc « Saturation » est lui aussi un
            // bouton (en-tête repliable, demandé le 2026-09-12), donc deux
            // boutons auraient le MÊME nom accessible dans la même vue. « Canal
            // Saturation » les sépare sans mentir — c'est ce que l'onglet fait.
            <div className="color-mixer__canaux" role="group" aria-label="Canal à régler">
              {CANAUX.map((c) => (
                <Toggle
                  key={c.id}
                  size="sm"
                  pressed={canal === c.id}
                  onPressedChange={() => setCanal(c.id)}
                  aria-label={`Canal ${c.label}`}
                >
                  {c.label}
                </Toggle>
              ))}
              <Toggle size="sm" pressed={canal === "tout"} onPressedChange={() => setCanal("tout")} aria-label="Tous les canaux">
                Tout
              </Toggle>
            </div>
          )}
        </>
      )}

      <ParamPanel
        layer={layer}
        onParamChange={onParamChange}
        onParamCommit={onParamCommit}
        onOpenColorPicker={() => {}}
        presentation={presentation}
        develop
        flat
      />
    </div>
  );
}
