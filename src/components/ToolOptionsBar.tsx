import { Move, Shapes } from "lucide-react";
import { Select } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { ColorGroupControl } from "./ui/color-group-control";
import { BrushToolbar } from "./BrushToolbar";
import { aplat } from "../render/effects/aplat";
import type { EffectParam } from "../render/effects/types";
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
  /** Ouvre le sélecteur de couleur, aligné sur la pastille. Même canal que le
   *  dock : la barre ne fabrique pas son propre picker. */
  onOpenColorPicker?: (anchorTop: number) => void;
  /** SÉLECTION AUTO (ticket 26), option de l'outil Déplacer. Booléen d'INTERFACE
   *  possédé par `App` — pas un `ToolOptions`, qui ne porte que des réglages
   *  NUMÉRIQUES semant le prochain calque créé (`toolOptionsModel`), ce que
   *  l'outil Déplacer ne fait jamais. Défaut OFF, convention Photoshop. */
  autoSelect?: boolean;
  onAutoSelectChange?: (checked: boolean) => void;
}

/** Défaut d'un paramètre d'`aplat`, lu sur le module. */
function paramAplat(nom: string): EffectParam {
  const param = aplat.params.find((p) => p.name === nom);
  if (!param) throw new Error(`paramètre aplat inconnu : ${nom}`);
  return param;
}

function defautAplat(nom: string): number {
  return paramAplat(nom).default;
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

export function ToolOptionsBar({ outil, options, onOptionChange, pinceau, onOpenColorPicker, autoSelect = false, onAutoSelectChange }: Props) {
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
          {/* LA MÊME PASTILLE QUE LE DOCK, et pas trois curseurs de plus.
              `ColorGroupControl` porte le carré de couleur, son hexadécimal, le
              repli sur les trois curseurs, et l'ouverture du sélecteur de
              couleur. La barre en portait une copie déroulée : trois curseurs
              nus, sans pastille ni picker — donc « le prochain rectangle sera
              bleu » demandait de composer un bleu de tête en TSL.

              C'est aussi ce qu'ADR-0001 attend d'un contrôle qui se répète : la
              couleur d'un aplat se règle au MÊME endroit visuel, que la forme
              existe déjà (dock) ou pas encore (barre). Deux apparences pour la
              même valeur auraient été le défaut que le ticket 27 borne. */}
          <ColorGroupControl
            label="Couleur"
            hueParam={paramAplat("teinte")}
            saturationParam={paramAplat("saturation")}
            lightnessParam={paramAplat("clarte")}
            hue={valeurForme(options, "teinte")}
            saturation={valeurForme(options, "saturation")}
            lightness={valeurForme(options, "clarte")}
            onChange={(nom, valeur) => onOptionChange("shape", nom, valeur)}
            onCommit={() => {}}
            onOpenPicker={onOpenColorPicker}
          />
        </>
      )}

      {outil === "move" && (
        <>
          <span className="brush-toolbar__tool">
            <Move className="icon-md icon-stroke" aria-hidden="true" />
            Déplacer — glisser une image, ses poignées la tournent et la
            redimensionnent
          </span>
          {/* SÉLECTION AUTO (ticket 26). Contrôle composé depuis `ui/` (ADR-0001) ;
              la barre est son habillage BEM. Cochée, un clic sur la toile
              sélectionne le calque le plus haut qui couvre ce pixel. */}
          {onAutoSelectChange && (
            <Checkbox label="Sélection auto" checked={autoSelect} onChange={onAutoSelectChange} />
          )}
        </>
      )}
    </div>
  );
}
