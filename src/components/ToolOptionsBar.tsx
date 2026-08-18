import { Move, Shapes } from "lucide-react";
import { LabeledSlider } from "./ui/labeled-slider";
import { Select } from "./ui/select";
import { BrushToolbar } from "./BrushToolbar";
import { aplat } from "../render/effects/aplat";
import type { ToolId } from "../ui/tools";
import { optionsDe, type ToolOptions } from "../ui/toolOptionsModel";

/**
 * BARRE D'OPTIONS DE L'OUTIL — permanente, à hauteur CONSTANTE, contenu suivant
 * l'outil actif. Voie A du ticket 27, arbitrée le 2026-08-18.
 *
 * ── LE DÉFAUT QU'ELLE CORRIGE, ET IL ÉTAIT MESURÉ ───────────────────────────
 *
 * `BrushToolbar` n'était montée qu'en mode masque. Mesuré dans la vraie fenêtre
 * à 1280 × 720, en passant de *Déplacer* au *Pinceau* :
 *
 *   haut de la toile        y 57 -> y 132   (+75 px)
 *   hauteur de la toile     663  -> 588     (-11,3 %)
 *   haut de la palette      y 73 -> y 148   (+75 px)
 *
 * Le troisième chiffre est le défaut. Une toile qui se réduit est un arbitrage
 * discutable ; **une palette d'outils qui se déplace de 75 px au moment où on
 * clique dedans** n'en est pas un. C'est la seule surface dont la position doit
 * être stable, puisque c'est ce à quoi elle sert.
 *
 * D'où la barre PERMANENTE : la bande existe toujours, même pour *Déplacer* qui
 * n'a rien à régler. La place perdue est le prix de la stabilité, et le ticket
 * l'a arbitrée comme telle.
 *
 * ── LES VALEURS APPARTIENNENT À L'OUTIL ─────────────────────────────────────
 *
 * « Le prochain rectangle sera bleu. » Les réglages posés ici ne touchent aucun
 * calque existant : ils sèment le PROCHAIN tracé. Le modèle
 * (`ui/toolOptionsModel.ts`) rend cette frontière inexprimable autrement — il ne
 * reçoit ni pile, ni sélection, ni identifiant.
 *
 * ⚠️ LES DÉFAUTS NE SONT PAS ÉCRITS ICI. Un réglage jamais touché lit
 * `EffectParam.default` du module d'effet, sa seule source de vérité. Les
 * recopier aurait créé un second endroit où vit la valeur par défaut d'un
 * paramètre, et les deux auraient dérivé au premier ajustement.
 *
 * ── CE QUE LA BARRE PORTE POUR *FORME*, ET POURQUOI PAS PLUS ────────────────
 *
 * La primitive et la couleur. C'est exactement le défaut nommé par Antoine — on
 * trace un rectangle NOIR, puis on va chercher sa couleur dans le dock — et rien
 * de plus : le ticket écarte explicitement de recopier la liste de Photoshop
 * (« fond, contour, primitive, angle »), notre contour n'existant pas et notre
 * `aplat` portant un dégradé que Photoshop n'a pas dans sa barre.
 */

interface Props {
  outil: ToolId;
  options: ToolOptions;
  onOptionChange: (outil: ToolId, nom: string, valeur: number) => void;
  /** Réglages du pinceau. Ils vivent encore dans `App` et non dans `options` :
   *  ce sont les seuls qui pilotent un geste EN COURS (le trait), pas le
   *  prochain objet créé — voir la note de bas de fichier. */
  pinceau: React.ComponentProps<typeof BrushToolbar>;
}

/** Défaut d'un paramètre d'`aplat`, lu sur le module. */
function defautAplat(nom: string): number {
  const param = aplat.params.find((p) => p.name === nom);
  if (!param) throw new Error(`paramètre aplat inconnu : ${nom}`);
  return param.default;
}

/**
 * SEULE EXCEPTION à « les défauts viennent du module d'effet », et elle a sa
 * raison : le défaut de `borne` dans `aplat` est **0**, c'est-à-dire « bornée par
 * le masque » — toute la toile. Ce n'est pas une primitive qu'un outil de TRACÉ
 * puisse offrir : on ne trace pas « aucune forme ».
 *
 * Le défaut de l'OUTIL est donc le rectangle, ce qui est exactement la valeur
 * que `handleShapeDrawn` écrivait en dur avant cette barre. La différence n'est
 * pas un doublon de défaut : le module dit ce qu'est un aplat SANS geste, l'outil
 * dit ce que TRACER produit.
 *
 * ⚠️ Trouvé en regardant la capture, pas en lisant le code : le sélecteur
 * affichait « 0 », une valeur absente de sa propre liste de choix.
 */
const DEFAUTS_OUTIL_FORME: Readonly<Record<string, number>> = { borne: 1 };

function valeurForme(options: ToolOptions, nom: string): number {
  return optionsDe(options, "shape")[nom] ?? DEFAUTS_OUTIL_FORME[nom] ?? defautAplat(nom);
}

/** Les trois primitives que l'outil sait tracer. Les index sont ceux de
 *  `aplat.params[0]` (`borne`), PERSISTÉS dans les presets — c'est ce qui rend
 *  la citation sûre, pas une négligence. « Aucune » (index 0) n'y est pas : elle
 *  veut dire « toute la toile », ce qui n'est pas une forme qu'on trace. */
const PRIMITIVES = [
  { value: "1", label: "Rectangle" },
  { value: "2", label: "Ellipse" },
  { value: "3", label: "Polygone" },
];

export function ToolOptionsBar({ outil, options, onOptionChange, pinceau }: Props) {
  return (
    <div className="tool-options-bar" role="toolbar" aria-label="Options de l'outil">
      {(outil === "brush" || outil === "eraser") && <BrushToolbar {...pinceau} />}

      {outil === "shape" && (
        <>
          <span className="brush-toolbar__tool">
            <Shapes className="icon-md icon-stroke" aria-hidden="true" />
            Forme
          </span>
          <Select
            label="Primitive"
            labelPlacement="inline"
            value={String(valeurForme(options, "borne"))}
            options={PRIMITIVES}
            onChange={(v) => onOptionChange("shape", "borne", Number(v))}
          />
          <div className="brush-toolbar__control">
            <LabeledSlider
              label="Teinte"
              displayValue={`${Math.round(valeurForme(options, "teinte"))}°`}
              value={valeurForme(options, "teinte")}
              min={0}
              max={360}
              step={1}
              onChange={(v) => onOptionChange("shape", "teinte", v)}
            />
          </div>
          <div className="brush-toolbar__control">
            <LabeledSlider
              label="Saturation"
              displayValue={`${Math.round(valeurForme(options, "saturation") * 100)} %`}
              value={valeurForme(options, "saturation")}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onOptionChange("shape", "saturation", v)}
            />
          </div>
          <div className="brush-toolbar__control">
            <LabeledSlider
              label="Luminosité"
              displayValue={`${Math.round(valeurForme(options, "clarte") * 100)} %`}
              value={valeurForme(options, "clarte")}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onOptionChange("shape", "clarte", v)}
            />
          </div>
        </>
      )}

      {outil === "move" && (
        <span className="brush-toolbar__tool">
          <Move className="icon-md icon-stroke" aria-hidden="true" />
          Déplacer — glisser une image, ses poignées la tournent et la
          redimensionnent
        </span>
      )}
    </div>
  );
}
