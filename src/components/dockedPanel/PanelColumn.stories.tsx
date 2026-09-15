import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelColumn, type DockedPanelSpec } from "./PanelColumn";
import { singleGroup } from "../../ui/dockLayout";
import type { DockLayout } from "../../ui/dockLayout";
// La garde de densité ci-dessous mesure la carte Effets REELLE (liste de
// calques + zone de contrôles en pied) : un contenu factice n'aurait ni la même
// hauteur de chrome ni la même géométrie de ligne, donc ne prouverait rien.
import { LayerControls, LayerPanel } from "../LayerPanel";
import { defaultLayerMask } from "../../mask/types";
import type { LayerState } from "../../layers/types";

function makeStoryLayer(overrides: Partial<LayerState>): LayerState {
  return {
    id: "layer",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

const layout: DockLayout = [[singleGroup("layers"), singleGroup("properties")]];

const panels: DockedPanelSpec[] = [
  { id: "layers", title: "Pile", content: <p style={{ margin: 0 }}>Structure du document.</p> },
  { id: "properties", title: "Propriétés · Glow", content: <p style={{ margin: 0 }}>Effet ou masque de la cible.</p> },
];

const meta: Meta<typeof PanelColumn> = {
  title: "Components/DockedPanel/PanelColumn",
  component: PanelColumn,
  args: {
    panels,
    layout,
    onMove: () => {},
    width: 320,
    onWidthChange: () => {},
    onSetActiveTab: () => {},
    onGroupCollapsedChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PanelColumn>;

export const Default: Story = {};

export const SingleColumn: Story = {
  args: { layout: [[singleGroup("layers"), singleGroup("properties")]] },
};

// --- State variants ---

export const AllCollapsed: Story = {
  args: {
    layout: [[{ ...singleGroup("layers"), collapsed: true }, { ...singleGroup("properties"), collapsed: true }]],
  },
};

export const AllExpanded: Story = {
  args: {
    layout: [[singleGroup("layers"), singleGroup("properties")]],
  },
};

export const SinglePanel: Story = {
  args: {
    panels: [panels[0]],
    layout: [[singleGroup("layers")]],
  },
};

export const Narrow: Story = {
  args: { width: 220 },
};

// --- Plancher de compression ---

// GARDE ANTI-RÉCIDIVE (2026-07-28). Le plancher de compression existait depuis
// `5a77077` mais n'a JAMAIS atteint le DOM pendant trois commits : `gridRef`
// n'était attaché à aucun élément, donc le `useLayoutEffect` sortait à son
// premier `if (!grid) return`, aucune des trois variables CSS n'était publiée,
// et `min-height` retombait sur des valeurs de repli à 0px. Rien dans la suite
// de tests ne pouvait le voir — la convention du projet interdit de rendre un
// composant React en Vitest, et le défaut n'est observable qu'au niveau du
// style CALCULÉ, après montage. C'est donc ici, et nulle part ailleurs, que ça
// se vérifie.
export const ListCardHasCompressionFloor: Story = {
  args: {
    layout: [[singleGroup("layers")]],
    panels: [
      {
        id: "layers",
        title: "Pile",
        variableLength: true,
        content: (
          <ul data-dock-list="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {["Glow", "Grain", "Warp"].map((name) => (
              <li key={name} style={{ height: 44 }}>
                {name}
              </li>
            ))}
          </ul>
        ),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const item = canvasElement.querySelector<HTMLElement>(".panel-column__item");
    await expect(item).not.toBeNull();
    // La valeur exacte dépend des tokens et de la hauteur de ligne mesurée ;
    // ce qui se verrouille ici est qu'un plancher EXISTE. `0px` = les variables
    // n'ont pas atteint le DOM, la carte peut être écrasée jusqu'à disparaître.
    await expect(getComputedStyle(item!).minHeight).not.toBe("0px");
  },
};

// GARDE ANTI-RÉCIDIVE (2026-07-28) — le DOCUMENT MINIMAL À DEUX PHOTOS tient
// sans qu'aucune ligne ne se cache.
//
// Cinq lignes : arrière-plan · Glow · Grain · une photo importée · un effet
// posé sur elle. C'est le plus petit
// document réel comportant deux photos. Mesuré sur la vraie fenêtre puis
// reproduit ici au byte près : carte Effets gelée à 456px — exactement son
// plancher à 4 lignes — et `.docked-panel-card__content` débordant de 60px,
// soit une ligne (52) plus sa gouttière (8). La 5e ligne était hors champ.
//
// Ce qui est verrouillé ici, et que rien d'autre ne peut voir (les lignes sont
// conformes une par une, c'est leur SOMME face à la hauteur allouée qui
// fautait) :
//   1. les 5 lignes sont entièrement dans la zone défilante de la carte ;
//   2. cette zone ne déborde pas ;
//   3. c'est bien la CARTE qui borne, pas la colonne — la grille ne défile pas
//      (corollaire indissociable de l'ADR-0001) ;
//   4. une ligne fait au plus 56px hors sélection (checklist ADR-0001, point 3) ;
//   5. un nom de fichier long s'ELLIPSE au lieu d'élargir la colonne, ET il lui
//      reste assez de largeur pour être lu (ajouté le 2026-07-29 : c'est la
//      mesure qui manquait quand le nom est tombé à 52 px).
//
// La hauteur de fenêtre est SIMULÉE (surcharge de `max-height` sur la grille) :
// le runner de stories a son propre viewport, et cette garde doit mesurer la
// répartition de hauteur, pas la taille de la fenêtre du runner.
const DOCK_VIEWPORT_HEIGHT = 1377;
const DOCK_VIEWPORT_MARGIN = 32;
/** Hauteurs de contenu des quatre autres cartes, relevées sur la vraie fenêtre
 *  (mesure CDP du 2026-07-27 reprise dans l'ADR-0001). Elles ne sont pas du
 *  décor : sans elles la colonne n'est pas en déficit, aucune carte n'est
 *  comprimée, et la garde ne garderait rien. */
const OTHER_PANEL_CONTENT_HEIGHTS = { presets: 88, properties: 334 };

const fillerPanel = (id: string, title: string, height: number, variableLength = false): DockedPanelSpec => ({
  id,
  title,
  variableLength,
  content: <div style={{ height }} />,
});

const twoPhotoDocument: LayerState[] = [
  // La photo de FOND est un calque depuis la tranche T1 (design 2026-07-28) :
  // elle occupe une VRAIE ligne de la liste, là où elle était une ligne dérivée
  // rendue à part. Le document reste donc à cinq lignes, ce que garde le nom de
  // cette story.
  makeStoryLayer({
    id: "background",
    effectId: "passthrough",
    name: "DSCF5160.JPG",
    imageSource: { sourceId: "s0" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
  makeStoryLayer({ id: "glow", effectId: "glow" }),
  makeStoryLayer({ id: "grain", effectId: "grain" }),
  makeStoryLayer({
    id: "photo",
    effectId: "passthrough",
    // Nom LONG à dessein : c'est le cas rapporté (« DSCF5160-edited.JPG »
    // collait le pourcentage), reproduit à la largeur de dock par défaut. Un
    // nom court laisserait de la marge et la garde ne garderait rien.
    name: "DSCF5160-edited-panorama-final.JPG",
    imageSource: { sourceId: "s1" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
  makeStoryLayer({ id: "bleed", effectId: "lensDistortion" }),
];

export const FiveRowDocumentHidesNoRow: Story = {
  render: () => (
    <div className="sb-dock-viewport" style={{ position: "relative", height: DOCK_VIEWPORT_HEIGHT }}>
      <style>{`.sb-dock-viewport .panel-column__grid { max-height: ${DOCK_VIEWPORT_HEIGHT - DOCK_VIEWPORT_MARGIN}px; }`}</style>
      <PanelColumn
        // TROIS GROUPES d'un onglet chacun, et pas un groupe a trois onglets :
        // cette story est l'une des deux gardes qu'ADR-0001 nomme pour son
        // point 6, et elle mesure la GRILLE DE LIGNE sur trois cartes ouvertes
        // EN MEME TEMPS. En onglets, une seule se rendrait et la garde ne
        // garderait plus rien.
        layout={[[singleGroup("presets"), singleGroup("layers"), singleGroup("properties")]]}
        onMove={() => {}}
        width={320}
        onWidthChange={() => {}}
        onSetActiveTab={() => {}}
        onGroupCollapsedChange={() => {}}
        panels={[
          fillerPanel("presets", "Presets", OTHER_PANEL_CONTENT_HEIGHTS.presets, true),
          {
            id: "layers",
            title: "Pile",
            variableLength: true,
            controlsPlacement: "bottom",
            controls: (
              <LayerControls
                layers={twoPhotoDocument}
                selectedId="bleed"
                onOpacityChange={() => {}}
                onOpacityCommit={() => {}}
                onBlendModeChange={() => {}}
                onToggleLock={() => {}}
                onDuplicate={() => {}}
                onRemove={() => {}}
                onStamp={() => {}}
                onMergeDown={() => {}}
              />
            ),
            content: (
              <LayerPanel
                layers={twoPhotoDocument}
                selectedId="bleed"
                hasImage
                onSelect={() => {}}
                onToggle={() => {}}
                onAdd={() => {}}
                onReorder={() => {}}
              />
            ),
          },
          fillerPanel("properties", "Propriétés · Lens distortion", OTHER_PANEL_CONTENT_HEIGHTS.properties),
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector<HTMLElement>(".panel-column__grid")!;
    const card = canvasElement.querySelectorAll<HTMLElement>(".panel-column__item")[1]
      .querySelector<HTMLElement>(".docked-panel-card")!;
    const content = card.querySelector<HTMLElement>(".docked-panel-card__content")!;
    const rows = Array.from(content.querySelectorAll<HTMLElement>(".layer-panel__row"));

    // Le document mesuré : 5 lignes. Sous la règle de PROXIMITÉ (2026-07-29),
    // TROIS sont imbriquées — Glow et Grain sous le FOND du document (aucun
    // calque photo n'est appliqué avant eux), le dernier effet sous la photo
    // importée. Seuls l'arrière-plan et la photo importée sont racine. C'est exactement
    // le document sur lequel Antoine a constaté qu'une seule ligne sur quatre
    // était indentée : cette assertion est ce qui l'empêche de revenir.
    await expect(rows).toHaveLength(5);
    await expect(rows.map((row) => row.classList.contains("layer-panel__row--nested"))).toEqual([
      false, true, true, false, true,
    ]);

    // 1+2. Aucune ligne hors champ, et la zone défilante ne déborde pas.
    const contentBottom = content.getBoundingClientRect().bottom;
    await expect(rows.map((row) => row.getBoundingClientRect().bottom <= contentBottom + 0.5)).toEqual([
      true, true, true, true, true,
    ]);
    await expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight);

    // 3. La colonne ne défile pas : c'est la carte qui borne (ADR-0001).
    await expect(grid.scrollHeight).toBeLessThanOrEqual(grid.clientHeight);

    // 4. Densité de ligne (checklist ADR-0001, point 3). Le budget est SERRÉ :
    // 2 px de trop par ligne suffisent à renvoyer la cinquième hors champ — la
    // ligne d'arrière-plan les a réellement pris le 2026-07-29 en repliant sa
    // grille sur deux rangées (voir `.layer-panel__row-main > *`,
    // LayerPanel.css). Cette assertion-ci ne l'aurait PAS vu (54 <= 56) ; c'est
    // le point 2 ci-dessus qui l'a attrapé.
    for (const row of rows) await expect(row.offsetHeight).toBeLessThanOrEqual(56);

    // 5. Le nom cède plutôt que d'élargir la colonne — et il lui reste de quoi
    // se lire. Le « % » en lecture seule contre lequel il venait buter a quitté
    // la ligne le 2026-07-29 avec les autres contrôles répétés (ADR-0001) :
    // c'est la LARGEUR RENDUE au nom qui se mesure désormais, parce que c'est
    // elle qui manquait — à 52 px, « DSCF5160-edited.JPG » s'affichait « DSC… ».
    const photoRow = rows[3];
    const name = photoRow.querySelector<HTMLElement>(".layer-panel__row-name")!;
    // ⚠️ L'ELLIPSE SE MESURE SUR `__row-label`, PAS SUR `__row-name`, depuis le
    // 2026-08-16 : la cellule du nom est devenue un FLEX pour tenir la pastille
    // du groupe replié à côté du libellé, et c'est le libellé qui tronque
    // désormais. Mesurée sur la cellule, la comparaison rendait `118 > 118` —
    // un témoin muet, qui aurait laissé passer un nom non tronqué et donc une
    // mesure de largeur qui ne prouve plus rien.
    const label = photoRow.querySelector<HTMLElement>(".layer-panel__row-label")!;
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth); // ellipse active
    // 152 px mesurés ici, contre 176 px dans `LayerPanel.stories.tsx` : la
    // différence est le CHROME de la carte (padding de `.docked-panel-card` et
    // de sa zone défilante), absent d'une story qui monte le panneau nu à 320 px.
    // C'est CE chiffre-ci qui est celui de la vraie fenêtre.
    // ⚠️ LE SEUIL EST DÉRIVÉ, PLUS ÉCRIT EN DUR (2026-08-16, arbitrage
    // d'Antoine). Il valait 145 px, calé sur la mesure du 2026-07-29, et il a
    // rougi à l'arrivée de la piste du chevron : `expected 118 to be greater
    // than or equal to 145`. Le nom est bien passé de 148/134 à 118/104 px sur
    // cette carte — mais la question que pose l'ADR-0001 point 6 est « le nom
    // garde-t-il une largeur LISIBLE ? », pas « atteint-il 145 px ».
    //
    // Mesuré : le plus long libellé du registre est `Lens distortion`, 79 px
    // dans la police de la ligne. Aucun des 23 effets ne tronque à 104. Ce qui
    // tronque est un NOM DE FICHIER, qui tronquait déjà à 152 et que aucune
    // largeur ne sauvera — son repli est le `title` posé sur l'élément.
    //
    // On mesure donc ce que la question demande : que la piste contienne le
    // plus long libellé qu'elle a réellement à rendre. Le garde d'origine tient
    // — un contrôle qui revient sur la ligne et écrase le nom fait tomber la
    // mesure sous le libellé — sans pouvoir se périmer quand les libellés
    // changent. Même remède que `LayerPanel.stories.tsx > AllRowFormsShareOneGrid`.
    const cs = getComputedStyle(label);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const plusLongLibelle = Math.max(
      ...Array.from(content.querySelectorAll<HTMLElement>(".layer-panel__row-label"))
        // Les noms de FICHIER sont hors budget par nature : ils tronquent à
        // toute largeur, et les inclure ferait de ce seuil une loterie.
        .filter((n) => !(n.textContent ?? "").includes("."))
        .map((n) => ctx.measureText(n.textContent ?? "").width),
    );
    await expect(name.getBoundingClientRect().width).toBeGreaterThanOrEqual(plusLongLibelle);
    // La colonne garde sa largeur réservée : le nom n'a pas le droit de
    // l'élargir (c'est ce que `min-width: 0` sur .panel-column__stack empêche).
    await expect(photoRow.offsetWidth).toBeLessThanOrEqual(320);
  },
};

// --- Interaction test (play) ---

// Le repli remonte par `onGroupCollapsedChange`, avec l'id de l'onglet ACTIF
// du groupe — c'est le GROUPE qui se replie, pas un panneau. Cliquer le bouton
// de la seule carte depliee (Calques) doit donc rapporter ("layers", true).
export const CollapsePanelCallsSpec: Story = {
  args: {
    layout: [[singleGroup("layers"), { ...singleGroup("properties"), collapsed: true }]],
    onGroupCollapsedChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Seule "Calques" est dépliée -> un unique bouton "Replier le panneau".
    const collapse = canvas.getByRole("button", { name: "Replier le panneau" });
    await userEvent.click(collapse);

    await expect(args.onGroupCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(args.onGroupCollapsedChange).toHaveBeenCalledWith("layers", true);
  },
};

// GARDE DU MODELE A ONGLETS (2026-08-19). Deux panneaux dans UN groupe : la
// barre porte deux onglets, un seul contenu se rend, et cliquer l'onglet
// inactif remonte `onSetActiveTab` avec son id. C'est ce qui distingue un
// groupe d'une pile de cartes, et rien d'autre ne le verifie.
export const TabGroupShowsOneContent: Story = {
  args: {
    layout: [[{ tabs: ["layers", "properties"], active: "layers", collapsed: false }]],
    onSetActiveTab: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Les DEUX onglets sont visibles — c'est tout l'interet du modele : on
    // voit que l'autre panneau existe.
    const onglets = canvas.getAllByRole("tab");
    await expect(onglets).toHaveLength(2);

    // Mais un seul CONTENU se rend.
    await expect(canvas.getByText("Structure du document.")).toBeVisible();
    await expect(canvas.queryByText("Effet ou masque de la cible.")).toBeNull();

    await userEvent.click(canvas.getByRole("tab", { name: "Propriétés · Glow" }));
    await expect(args.onSetActiveTab).toHaveBeenCalledWith("properties");
  },
};

/**
 * GARDE DU PIRE CAS QU'UN GLISSEMENT PERMET : les QUATRE cartes dans UNE seule
 * colonne, carte Développement comprise.
 *
 * Pourquoi elle manquait. `FiveRowDocumentHidesNoRow` juste au-dessus garde un
 * défaut précis et le garde bien — mais sur TROIS cartes, la disposition de
 * 2026-07-27. L'application en monte QUATRE depuis le 2026-09-11, et la carte
 * Développement est de très loin la plus lourde. Elle vit normalement dans une
 * autre colonne que la Pile, ce qui répartit la pression ; rien n'empêche
 * l'utilisateur de tout glisser dans une seule, et c'est ce cas-là que personne
 * ne mesurait.
 *
 * Les hauteurs de contenu sont MESURÉES sur la vraie fenêtre le 2026-09-15, un
 * document ouvert et un module de l'étage réglé (sonde CDP) :
 *   Presets 132 · Pile 112 · Propriétés 334 (relevé 2026-07-27) · Développement
 *   **2972**.
 *
 * Ce dernier chiffre est tout l'objet de la story : l'étage porte trois modules
 * et des dizaines de curseurs, donc sa hauteur NATURELLE dépasse la fenêtre à
 * elle seule. Ce qui doit tenir, c'est que la carte le borne et défile DEDANS —
 * jamais la colonne (ADR-0001). Mesuré le même jour sur la vraie fenêtre :
 * `scrollHeight === clientHeight === 1205` sur la colonne, avec cette carte
 * dedans. La chaîne de compression marche ; cette garde est ce qui l'empêche de
 * cesser de marcher.
 */
const DEVELOP_CONTENT_HEIGHT = 2972;

export const FourCardsInOneColumnDoNotScrollTheColumn: Story = {
  render: () => (
    <div className="sb-dock-viewport" style={{ position: "relative", height: DOCK_VIEWPORT_HEIGHT }}>
      <style>{`.sb-dock-viewport .panel-column__grid { max-height: ${DOCK_VIEWPORT_HEIGHT - DOCK_VIEWPORT_MARGIN}px; }`}</style>
      <PanelColumn
        layout={[[singleGroup("presets"), singleGroup("layers"), singleGroup("properties"), singleGroup("develop")]]}
        onMove={() => {}}
        width={320}
        onWidthChange={() => {}}
        onSetActiveTab={() => {}}
        onGroupCollapsedChange={() => {}}
        panels={[
          fillerPanel("presets", "Presets", OTHER_PANEL_CONTENT_HEIGHTS.presets, true),
          fillerPanel("layers", "Pile", 112, true),
          fillerPanel("properties", "Propriétés · Lens distortion", OTHER_PANEL_CONTENT_HEIGHTS.properties),
          // `variableLength` désigne le RANG DE SACRIFICE — qui cède de la
          // hauteur en premier — et non le fait de céder.
          //
          // ⚠️ Vérifié, parce que j'avais écrit l'inverse : retirer ce drapeau
          // laisse la story VERTE. Ce qui borne réellement la carte est le
          // couple `min-height: 0` + `overflow-y` de sa zone défilante
          // (`DockedPanelCard.css`) ; le drapeau ne fait qu'ordonner les
          // cessions entre cartes. Le témoin qui rougit pour de vrai est plus
          // bas : casser ce couple par une surcharge fait échouer la story.
          fillerPanel("develop", "Développement", DEVELOP_CONTENT_HEIGHT, true),
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector<HTMLElement>(".panel-column__grid")!;
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>(".docked-panel-card"));

    // Témoin de SIGNAL : les quatre cartes sont bien rendues. Sans lui, un
    // layout qui n'en rendrait qu'une passerait au vert sans rien prouver.
    await expect(cards).toHaveLength(4);

    // Témoin de PRESSION : la carte Développement porte à elle seule plus que
    // la fenêtre. Si ce n'était pas le cas, la colonne ne serait pas en déficit
    // et la garde ne garderait rien — le même piège que les hauteurs des autres
    // cartes dans la story précédente.
    await expect(DEVELOP_CONTENT_HEIGHT).toBeGreaterThan(DOCK_VIEWPORT_HEIGHT);

    // L'INVARIANT : la colonne ne défile pas. C'est la carte qui borne.
    await expect(grid.scrollHeight).toBeLessThanOrEqual(grid.clientHeight);

    // Et elle borne en DÉFILANT DEDANS, ce qui est la seule façon acceptable de
    // tenir un contenu plus grand que la place — pas en le rognant.
    //
    // POUVOIR DISCRIMINANT ÉPROUVÉ, et pas supposé : surcharger la zone
    // défilante de la carte en `min-height: auto; overflow-y: visible` fait
    // échouer cette story. C'est ce couple-là qui tient ADR-0001, pas le
    // `variableLength` ci-dessus — essayé, la story reste verte sans lui.
    const develop = cards[3].querySelector<HTMLElement>(".docked-panel-card__content")!;
    await expect(develop.scrollHeight).toBeGreaterThan(develop.clientHeight);
  },
};
