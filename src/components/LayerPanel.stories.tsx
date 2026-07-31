import type { ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { LayerPanel } from "./LayerPanel";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

function makeLayer(overrides: Partial<LayerState>): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

/** Calque de FOND — la photo qui a ouvert le document. Depuis la tranche T1
 *  (design 2026-07-28) c'est un `LayerState` ordinaire portant `imageSource` :
 *  il n'y a plus de ligne d'arrière-plan dérivée ni de prop `backgroundName`.
 *  Les stories le mettent donc dans `layers`, en TÊTE de pile — ce que
 *  `App.tsx` fait à l'ouverture d'un document. */
function backgroundLayer(name = "DSC_0042.jpg"): LayerState {
  return makeLayer({
    id: "layer-background",
    effectId: "passthrough",
    name,
    imageSource: { sourceId: "s-background" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  });
}

const layers: LayerState[] = [
  makeLayer({ id: "layer-1", effectId: "glow", opacity: 1 }),
  makeLayer({ id: "layer-2", effectId: "chromaticBleed", opacity: 0.6, enabled: false }),
  makeLayer({ id: "layer-3", effectId: "grain", opacity: 0.35, blendMode: "screen" }),
];

const effectCycle = ["glow", "chromaticBleed", "warp", "grain"];
const manyLayers: LayerState[] = Array.from({ length: 8 }, (_, i) =>
  makeLayer({
    id: `layer-${i + 1}`,
    effectId: effectCycle[i % effectCycle.length],
    opacity: 1 - i * 0.1,
    enabled: i % 3 !== 0,
  })
);

const meta: Meta<typeof LayerPanel> = {
  title: "Components/LayerPanel",
  component: LayerPanel,
  args: {
    layers,
    selectedId: "layer-1",
    hasImage: true,
    onSelect: () => {},
    onToggle: () => {},
    onAdd: () => {},
    onReorder: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LayerPanel>;

export const Default: Story = {};

export const Empty: Story = {
  args: { layers: [], selectedId: null },
};

export const NoImageLoaded: Story = {
  args: { hasImage: false },
};

export const SecondSelected: Story = {
  args: { selectedId: "layer-2" },
};

export const ManyLayers: Story = {
  args: { layers: manyLayers, selectedId: "layer-3" },
};

// SENS D'AFFICHAGE (ADR-0004, 2026-07-28) : la liste se lit de haut en bas dans
// l'ordre du TRAITEMENT. `layers[0]` est le calque appliqué EN PREMIER — depuis
// la tranche T1 c'est la photo de fond elle-même, et les effets qui la
// consomment s'affichent en dessous. C'est le seul test qui verrouille ce sens :
// s'il tombe, un dépôt de glisser-déposer atterrira à l'envers.
export const StackOrderIsCausal: Story = {
  args: { layers: [backgroundLayer(), ...layers] },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    // QUATRE lignes indexées, plus aucune ligne dérivée hors index : le fond
    // est devenu une ligne comme les autres, donc réordonnable.
    await expect(rows.map((row) => row.getAttribute("data-layer-row-index"))).toEqual(["0", "1", "2", "3"]);
    await expect(rows.map((row) => row.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "DSC_0042.jpg",
      "Glow",
      "Chromatic bleed",
      "Grain",
    ]);
    // Toutes les lignes de la liste sont des lignes de calque — la ligne
    // d'arrière-plan dérivée a disparu avec T1.
    const allRows = Array.from(canvasElement.querySelectorAll(".layer-panel__row"));
    await expect(allRows).toHaveLength(rows.length);
  },
};

// LE FOND EST UN CALQUE (tranche T1, arbitrage n°2 du 2026-07-28). Ce qui lui
// manquait comme ligne dérivée — et qui laissait 50 px de vide à gauche de son
// nom, deux fois signalé à l'écran par Antoine — il l'a maintenant : une
// poignée, un œil, une sélection. Il n'est PAS verrouillé par défaut.
export const BackgroundIsAnOrdinaryLayer: Story = {
  args: { layers: [backgroundLayer(), ...layers], selectedId: "layer-background" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvasElement.querySelector<HTMLElement>('[data-layer-row-index="0"]')!;
    await expect(row.querySelector(".layer-panel__row-name")?.textContent).toBe("DSC_0042.jpg");
    // Les DEUX affordances qui manquaient — c'est leur absence qui creusait le
    // vide de 50 px, la grille réservant leurs colonnes sans personne dedans.
    await expect(row.querySelector(".layer-panel__grip-handle")).not.toBeNull();
    await expect(within(row).getByRole("button", { name: /Masquer le calque|Afficher le calque/ })).toBeTruthy();
    // Sélectionnable, et sélectionné ici.
    await expect(row.className).toContain("layer-panel__row--selected");
    // Plus AUCUN cadenas d'arrière-plan : le verrou du fond est devenu la
    // propriété `locked` ordinaire, absente par défaut.
    await expect(canvas.queryByRole("img", { name: "Arrière-plan verrouillé" })).toBeNull();
    await expect(canvas.queryAllByRole("img", { name: "Calque verrouillé" })).toHaveLength(0);
  },
};

// Écrêtage : la ligne écrêtée porte une flèche vers son calque de base — celui
// appliqué AVANT elle, donc, en sens causal (ADR-0004), la ligne JUSTE
// AU-DESSUS dans cette liste. Elle n'est PLUS indentée
// (observation Photoshop web §5ter) : elle est ici SÉLECTIONNÉE pour vérifier
// que le marquage couvre la ligne entière, alignée sur ses voisines.
const clippedLayers: LayerState[] = [
  makeLayer({
    id: "layer-1",
    effectId: "passthrough",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    name: "plage.jpg",
  }),
  makeLayer({ id: "layer-2", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "layer-3", effectId: "grain" }),
];

export const ClippedLayerSelected: Story = {
  args: { layers: clippedLayers, selectedId: "layer-2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img", { name: "Écrêté sur le calque du dessus" })).toBeTruthy();
  },
};

// Écrêtage SANS BASE : `clipToBelow` est posé sur `layers[0]`, le bas de pile —
// il n'y a rien en dessous. `resolveClipping` rend ce cas `inert` (le calque
// rend linéairement) et la flèche ne doit PAS apparaître : elle désignerait une
// base inexistante. La ligne reste écrêtable/décochable, seul l'affichage suit
// l'état résolu.
const clippedWithoutBase: LayerState[] = [
  makeLayer({ id: "layer-1", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "layer-2", effectId: "grain" }),
];

export const ClippedWithoutBaseShowsNoArrow: Story = {
  args: { layers: clippedWithoutBase, selectedId: "layer-1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("img", { name: "Écrêté sur le calque du dessus" })).not.toBeInTheDocument();
  },
};

// IMBRICATION — DIVERGENCE ASSUMÉE d'avec Photoshop, qui n'indente rien
// (observations §5ter). La RÈGLE est testée unitairement
// (test/components/layerTree.test.ts) ; ces stories ne vérifient que son
// RENDU : quelles lignes portent la classe d'indentation et le filet.
//
// Pile : P (photo) · A (effet) · Q (photo) · B (effet). Sous la règle de
// PROXIMITÉ (2026-07-29), chaque effet rejoint la photo qui le précède : A sous
// P, B sous Q. Deux groupes, aucune ligne d'effet à plat. C'est précisément ce
// que l'ancienne règle ne faisait pas — B y restait racine parce que DEUX
// photos étaient sous lui — et c'est le défaut qu'Antoine a constaté.
const twoPhotoLayers: LayerState[] = [
  makeLayer({ id: "photo-P", effectId: "passthrough", name: "plage.jpg", imageSource: { sourceId: "s-P" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
  makeLayer({ id: "layer-A", effectId: "glow" }),
  makeLayer({ id: "photo-Q", effectId: "passthrough", name: "ciel.jpg", imageSource: { sourceId: "s-Q" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
  makeLayer({ id: "layer-B", effectId: "grain" }),
];

export const NestedUnderPhoto: Story = {
  args: { layers: twoPhotoLayers, selectedId: "layer-A" },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    // Affichage : plage.jpg · Glow (imbriqué sous elle) · ciel.jpg · Grain (à plat).
    await expect(rows.map((r) => r.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "plage.jpg",
      "Glow",
      "ciel.jpg",
      "Grain",
    ]);
    // Chaque photo ouvre son groupe ; l'effet qui la suit lui appartient.
    await expect(rows.map((r) => r.classList.contains("layer-panel__row--nested"))).toEqual([
      false,
      true,
      false,
      true,
    ]);
    // Un filet par ligne enfant — décoratifs.
    const rails = canvasElement.querySelectorAll(".layer-panel__rail");
    await expect(rails).toHaveLength(2);
    for (const rail of rails) {
      await expect(rail.getAttribute("aria-hidden")).toBe("true");
      // Chaque groupe n'a qu'un enfant : son filet porte les DEUX bornes. Si
      // les bornes étaient calculées globalement au lieu de par groupe, le
      // second filet perdrait son `--first` et ne remonterait pas jusqu'à
      // ciel.jpg.
      await expect(rail.className).toContain("layer-panel__rail--first");
      await expect(rail.className).toContain("layer-panel__rail--last");
    }
  },
};

// L'index de LIGNE reste celui de l'ordre d'affichage plat : c'est lui que le
// glisser-déposer utilise pour son hit-test, et l'imbrication ne doit pas le
// décaler. S'il bouge, un dépôt atterrit au mauvais endroit du modèle.
export const NestingDoesNotShiftRowIndexes: Story = {
  args: { layers: twoPhotoLayers, selectedId: "layer-A" },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    await expect(rows.map((r) => r.getAttribute("data-layer-row-index"))).toEqual(["0", "1", "2", "3"]);
  },
};

// Parité calque photo (T1) : la ligne d'un calque photo affiche son NOM de
// fichier et sa vignette, plus « Passthrough ». La vignette est une object
// URL résolue par `thumbnailUrl` (possédée par PhotoSourceStore côté App) —
// ici un data URI 1x1 pour rester autonome, aucun raster en props.
const PHOTO_THUMB =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const photoLayers: LayerState[] = [
  makeLayer({
    id: "photo-layer",
    effectId: "passthrough",
    name: "IMG_1234.jpg",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
  makeLayer({ id: "layer-2", effectId: "glow" }),
];

export const PhotoLayerNamedWithThumbnail: Story = {
  args: {
    layers: photoLayers,
    selectedId: "photo-layer",
    thumbnailUrl: () => PHOTO_THUMB,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("IMG_1234.jpg")).toBeInTheDocument();
    await expect(canvas.queryByText("Passthrough")).not.toBeInTheDocument();
  },
};

export const PhotoLayerWithoutThumbnail: Story = {
  args: {
    layers: photoLayers,
    selectedId: "photo-layer",
    thumbnailUrl: () => null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // La vignette peut manquer ; le nom, lui, reste toujours affiché.
    await expect(canvas.getByText("IMG_1234.jpg")).toBeInTheDocument();
  },
};

// --- Interaction tests (play) ---

export const ClickLayerSelects: Story = {
  args: { selectedId: "layer-1", onSelect: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking the row name bubbles to the <li> onClick → onSelect(id).
    // Pas d'ambiguïté de texte : depuis 2026-07-27 les lignes ne portent plus
    // aucun sélecteur, seul le nom du calque porte ce libellé.
    await userEvent.click(canvas.getByText("Chromatic bleed"));
    await expect(args.onSelect).toHaveBeenCalledWith("layer-2");
  },
};

export const ToggleVisibility: Story = {
  args: { onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // layer-2 is disabled → its toggle is uniquely labeled "Afficher le calque".
    await userEvent.click(canvas.getByRole("button", { name: "Afficher le calque" }));
    // `altKey` = false : clic simple, bascule normale (voir eyeClickOutcome).
    await expect(args.onToggle).toHaveBeenCalledWith("layer-2", false);
  },
};

// Isolation (Alt+clic sur l'œil) : état d'AFFICHAGE seulement — `layers` est
// inchangé (layer-2 y reste `enabled: false`), seule la visibilité effective
// affichée par les icônes/libellés change. Le geste étant invisible, le libellé
// du bouton est le porteur de l'affordance de SORTIE.
export const IsolatedLayer: Story = {
  args: { isolatedLayerId: "layer-3", onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Les trois lignes annoncent la sortie d'isolation, y compris celle du
    // calque isolé : pendant l'isolation, un clic simple ne bascule rien.
    const exits = canvas.getAllByRole("button", { name: "Quitter l'isolation" });
    await expect(exits).toHaveLength(3);
    // La PREMIÈRE ligne est le calque appliqué en PREMIER depuis le sens causal
    // (ADR-0004) : `layers[0]`, donc layer-1.
    await userEvent.click(exits[0]);
    await expect(args.onToggle).toHaveBeenCalledWith("layer-1", false);
  },
};

// Alt+clic sur l'œil d'un calque : le composant ne décide de rien, il
// transmet le modificateur — c'est `eyeClickOutcome` qui tranche (testé
// unitairement, aucun test ne rend de composant React sur ce projet).
export const AltClickRequestsIsolation: Story = {
  args: { onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // `fireEvent` et non `userEvent` : le modificateur doit être porté par
    // l'événement de clic lui-même (`e.altKey`), ce que l'état clavier de
    // userEvent ne propage pas au clic dans ce runner.
    fireEvent.click(canvas.getByRole("button", { name: "Afficher le calque" }), { altKey: true });
    await expect(args.onToggle).toHaveBeenCalledWith("layer-2", true);
  },
};

// Le sélecteur d'effet a quitté les lignes pour la zone de contrôles
// centralisée (2026-07-27) : son test d'interaction vit dans
// `LayerControls.stories.tsx`. La liste ne doit plus en exposer aucun.
export const NoPerRowControls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("combobox", { name: "Effet" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("combobox", { name: "Fusion" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("slider", { name: "Opacité" })).toHaveLength(0);
  },
};

// DENSITÉ DE LA LIGNE (2026-07-29, ADR-0001) : dupliquer, supprimer, le verrou
// et l'opacité en lecture ont QUITTÉ les lignes pour la zone de contrôles de la
// carte, où ils agissent sur la sélection. Leurs tests d'interaction vivent
// désormais dans `LayerControls.stories.tsx`. Ce qui reste ici est la preuve
// qu'ils ne sont PLUS sur la ligne : sans elle, les réintroduire passerait au
// vert et le nom retomberait à 52 px.
export const NoPerRowActions: Story = {
  args: { layers: [makeLayer({ id: "layer-1", effectId: "glow", opacity: 0.35 })], selectedId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("button", { name: "Dupliquer le calque" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("button", { name: "Supprimer le calque" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("button", { name: "Verrouiller le calque" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("button", { name: "Déverrouiller le calque" })).toHaveLength(0);
    // L'opacité en lecture seule disparaît elle aussi : elle DOUBLAIT le champ
    // de la zone de contrôles, qui affiche la même valeur dans la même unité.
    await expect(canvas.queryByText("35 %")).not.toBeInTheDocument();
    // La ligne garde ce qui l'IDENTIFIE : l'œil, la nature, le nom.
    await expect(canvas.getAllByRole("button", { name: "Masquer le calque" })).toHaveLength(1);
    await expect(canvas.getByText("Glow")).toBeInTheDocument();
  },
};

// --- Alignement des colonnes (2026-07-29) ---

// LE test qui manquait. Le défaut qu'il attrape : les éléments de la ligne
// étaient posés bout à bout dans un flex avec DEUX enfants conditionnels au
// milieu (flèche d'écrêtage, vignette), donc un effet simple avait 4 éléments
// avant son nom, une photo 5, un effet écrêté 5 — et le nom ne tombait jamais à
// la même abscisse d'une ligne à l'autre. Aucun test ne le voyait : les stories
// existantes vérifient des PRÉSENCES (texte, rôle, classe), jamais une position.
//
// Les TROIS formes de ligne qui restent depuis la tranche T1 — la quatrième,
// la ligne d'arrière-plan DÉRIVÉE, a disparu : le fond est une ligne photo
// ordinaire, et c'est ce qui rend son alignement gratuit au lieu d'être une
// grille à tenir d'accord avec une autre.
//   1. photo de FOND  (`imageSource` -> vignette, comme toute photo)
//   2. photo importée (`imageSource` -> vignette)
//   3. photo importée (une seconde, pour que l'effet simple reste à plat)
//   4. effet ÉCRÊTÉ   (flèche coudée ; imbriqué sous sa base, cf. layerTree.ts)
//   5. effet simple   (rattaché par proximité à la photo qui le précède)
const allRowForms: LayerState[] = [
  backgroundLayer(),
  makeLayer({ id: "photo-P", effectId: "passthrough", name: "plage.jpg", imageSource: { sourceId: "s-P" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
  makeLayer({ id: "photo-Q", effectId: "passthrough", name: "ciel.jpg", imageSource: { sourceId: "s-Q" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
  makeLayer({ id: "effet-clip", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "effet-simple", effectId: "grain" }),
];

/** Largeur RÉELLE du dock (`--inspector-width-default`, src/design/components.css),
 *  posée sur le conteneur de la story : mesurer l'alignement dans un canvas de
 *  1000 px ne prouverait rien sur la colonne où le panneau vit vraiment, et ne
 *  verrait pas un débordement horizontal. */
const dockWidthDecorator = (Story: () => ReactElement) => (
  <div style={{ width: "var(--inspector-width-default)" }}>
    <Story />
  </div>
);

export const AllRowFormsShareOneGrid: Story = {
  args: {
    layers: allRowForms,
    selectedId: null,
    thumbnailUrl: () => PHOTO_THUMB,
  },
  decorators: [dockWidthDecorator],
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__row"));
    // Les cinq lignes sont bien là, dans l'ordre attendu (la photo de fond en
    // tête, ADR-0004) : sans ça, les mesures ci-dessous porteraient sur autre
    // chose. Toutes portent `data-layer-row-index` — plus aucune ligne dérivée.
    await expect(rows).toHaveLength(5);
    await expect(canvasElement.querySelectorAll("[data-layer-row-index]")).toHaveLength(5);
    await expect(rows.map((r) => r.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "DSC_0042.jpg",
      "plage.jpg",
      "ciel.jpg",
      "Glow",
      "Grain",
    ]);
    // Les formes sont réellement représentées — un témoin qui retirerait la
    // vignette ou la flèche ferait tomber CE bloc avant les mesures.
    await expect(canvasElement.querySelectorAll(".layer-panel__thumbnail")).toHaveLength(3); // les 3 calques photo
    await expect(canvasElement.querySelectorAll(".layer-panel__clip-arrow")).toHaveLength(1);

    // ---- L'INVARIANT DE GRILLE ----
    // Le nom démarre au MÊME décalage à l'intérieur de la grille d'identité,
    // sur les cinq lignes. C'est ce que la grille garantit, et c'est ce que le
    // flex ne garantissait pas. Mesuré relativement à `.layer-panel__row-main`
    // pour rester vrai malgré l'indentation d'imbrication (voir plus bas).
    const offsets = rows.map((row) => {
      const main = row.querySelector<HTMLElement>(".layer-panel__row-main");
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name");
      if (!main || !name) throw new Error("ligne sans grille d'identité ou sans nom");
      return Math.round(name.getBoundingClientRect().left - main.getBoundingClientRect().left);
    });
    await expect(new Set(offsets).size).toBe(1);

    // ---- CE QUE L'UTILISATEUR VOIT ----
    // Abscisse ABSOLUE du nom, identique sur les trois lignes NON imbriquées
    // (les trois calques photo, fond compris). C'est le constat d'Antoine —
    // « les icônes semblent positionnées un peu aléatoirement ».
    const absolute = (row: HTMLElement) => {
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name");
      if (!name) throw new Error("ligne sans nom");
      return Math.round(name.getBoundingClientRect().left);
    };
    const flat = [rows[0], rows[1], rows[2]];
    await expect(flat.every((r) => !r.className.includes("--nested"))).toBe(true);
    await expect(new Set(flat.map(absolute)).size).toBe(1);

    // Les lignes qui se décalent sont les lignes IMBRIQUÉES, et leur décalage
    // vient ENTIÈREMENT de l'indentation de la ligne (padding), pas d'un
    // décalage à l'intérieur de la grille — divergence voulue (layerTree.ts),
    // pas une dérive. Sous la règle de PROXIMITÉ les deux effets rejoignent
    // ciel.jpg, la photo qui les précède : elles sont donc imbriquées toutes
    // les deux, au même cran. Mesuré plutôt que lu dans le token :
    // `--layer-nest-indent` est un `calc()`, `getPropertyValue` rend la formule
    // non résolue et `parseFloat` en tirerait un 0 silencieux.
    const nested = [rows[3], rows[4]];
    await expect(nested.every((r) => r.className.includes("layer-panel__row--nested"))).toBe(true);
    const gridLeft = (row: HTMLElement) => {
      const main = row.querySelector<HTMLElement>(".layer-panel__row-main");
      if (!main) throw new Error("ligne sans grille d'identité");
      return Math.round(main.getBoundingClientRect().left);
    };
    const indentPx = gridLeft(rows[3]) - gridLeft(rows[2]);
    await expect(indentPx).toBeGreaterThan(0); // les lignes sont bien indentées
    await expect(new Set(nested.map(absolute)).size).toBe(1);
    await expect(absolute(rows[3]) - absolute(rows[2])).toBe(indentPx);

    // ---- DEUX ZONES (2026-07-29) ----
    // À gauche ce qui manipule et identifie (poignée · œil · marque · nom), à
    // droite ce que la ligne EST et son état (nature · verrou). L'icône de
    // nature vivait entre l'œil et la marque, où elle doublait la vignette sur
    // une ligne photo. `--nature` est rendue sur les CINQ lignes : si
    // une seule la perdait, la zone de droite ne serait plus lisible en
    // colonne.
    const natures = rows.map((row) => row.querySelector<HTMLElement>(".layer-panel__col--nature"));
    await expect(natures.every((n) => n !== null)).toBe(true);
    for (const row of rows) {
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name")!;
      const nature = row.querySelector<HTMLElement>(".layer-panel__col--nature")!;
      await expect(nature.getBoundingClientRect().left).toBeGreaterThanOrEqual(name.getBoundingClientRect().right);
    }
    // Et elle tombe à la MÊME abscisse sur les lignes non imbriquées, comme le
    // nom : c'est une colonne, pas une position d'écoulement.
    const natureLeft = (row: HTMLElement) =>
      Math.round(row.querySelector<HTMLElement>(".layer-panel__col--nature")!.getBoundingClientRect().left);
    await expect(new Set([rows[0], rows[1], rows[2]].map(natureLeft)).size).toBe(1);

    // La ligne d'ARRIÈRE-PLAN partage la MÊME définition de colonnes que les
    // lignes de calque — c'est ce qui rend ses pistes poignée et œil réservées
    // alors qu'elle n'y place rien, et ce qui les rendra prêtes le jour où le
    // fond aura un œil (tranche T1). Comparé sur la valeur RÉSOLUE : deux
    // `grid-template-columns` identiques au pixel près, pas deux règles CSS
    // qu'on suppose d'accord.
    const resolvedColumns = (row: HTMLElement) =>
      getComputedStyle(row.querySelector<HTMLElement>(".layer-panel__row-main")!).gridTemplateColumns;
    await expect(resolvedColumns(rows[0])).toBe(resolvedColumns(rows[1]));

    // ---- LARGEUR UTILE DU NOM (2026-07-29) ----
    // LA mesure qui manquait, et qui aurait attrapé le défaut avant l'écran :
    // rien ne vérifiait combien de place il RESTAIT au nom. À la largeur réelle
    // du dock, la ligne comptait sept colonnes — poignée, œil, verrou, nature,
    // flèche, vignette, nom — plus un groupe d'actions (opacité en lecture,
    // dupliquer, supprimer) : le nom tombait à 52 px, où « Chromatic bleed »
    // s'affiche « C… » et « DSCF5160-edited.JPG » « DSC… ».
    // Après migration des actions vers la zone de contrôles (ADR-0001) et
    // fusion de la flèche avec la vignette, il en reste plus du triple.
    // Le seuil est un PLANCHER, pas une valeur exacte : il doit résister à une
    // différence de métrique de police entre machines, tout en tombant
    // immédiatement si un contrôle revient s'installer sur la ligne.
    const nameWidth = (row: HTMLElement) => {
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name");
      if (!name) throw new Error("ligne sans nom");
      return Math.round(name.getBoundingClientRect().width);
    };
    // Ligne NON imbriquée (la plus large) et ligne imbriquée (amputée de
    // l'indentation) : les deux doivent rester lisibles.
    await expect(nameWidth(rows[1])).toBeGreaterThanOrEqual(170);
    await expect(nameWidth(rows[3])).toBeGreaterThanOrEqual(150);

    // ---- LE DOCK NE S'ÉLARGIT PAS ----
    // `min-width: 0` + ellipse du nom : aucune ligne ne déborde de la colonne,
    // à la largeur réelle du dock.
    const list = canvasElement.querySelector<HTMLElement>(".layer-panel__list");
    if (!list) throw new Error("liste introuvable");
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);

    // ---- ADR-0001 : ligne <= 56 px hors sélection ----
    // Aucune ligne n'est sélectionnée ici (`selectedId: null`).
    for (const row of rows) {
      await expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(56);
    }
  },
};

// --- Géométrie du filet (2026-07-29) ---

// LE test qui manquait, n°2. Le défaut qu'il attrape : le filet vertical
// démarrait EN DESSOUS de sa photo parente, 8 px de blanc entre les deux, et
// rien ne le voyait — `NestedUnderPhoto` vérifie quelles lignes PORTENT un
// filet et avec quelles bornes, jamais où ce filet commence.
//
// Cause mesurée : `.layer-panel__rail--first` ne franchissait que la gouttière
// de liste (`--space-4`) et s'arrêtait au bord de BOÎTE du parent, alors que le
// CONTENU visible du parent (`.layer-panel__row-top`) s'arrête un `--space-4`
// plus haut, la ligne portant `padding: var(--space-4)`. Il fallait franchir
// les DEUX. Relevé avant correctif : contenu du parent à 159,59 px, haut du
// filet à 167,59 px.
//
// La mesure porte sur le bas du CONTENU du parent, pas sur le bas de sa boîte :
// c'est le contenu que l'œil lit comme « la ligne », et le bord de boîte était
// déjà touché quand le blanc était visible à l'écran. Un test écrit contre le
// bord de boîte serait passé au vert sur le défaut rapporté.
//
// Les deux formes de parent sont couvertes — la photo de FOND (Glow lui est
// rattaché par proximité, ADR-0005) et une photo IMPORTÉE (Grain, rattaché à
// plage.jpg). Depuis la tranche T1 les deux sont des lignes de calque : c'est
// la même forme de ligne, ce qui est précisément l'acquis de la tranche.
const twoParentKinds: LayerState[] = [
  backgroundLayer(),
  makeLayer({ id: "layer-A", effectId: "glow" }),
  makeLayer({ id: "photo-P", effectId: "passthrough", name: "plage.jpg", imageSource: { sourceId: "s-P" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
  makeLayer({ id: "layer-B", effectId: "grain" }),
];

export const RailTouchesParentRow: Story = {
  args: { layers: twoParentKinds, selectedId: null },
  decorators: [dockWidthDecorator],
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__row"));
    // Affichage : DSC_0042.jpg · Glow (sous le fond) · plage.jpg · Grain (sous
    // elle). Sans ce bloc, les mesures pourraient porter sur une autre pile.
    await expect(rows).toHaveLength(4);
    await expect(rows.map((r) => r.classList.contains("layer-panel__row--nested"))).toEqual([
      false, true, false, true,
    ]);

    const contentBottom = (row: HTMLElement) => {
      const top = row.querySelector<HTMLElement>(".layer-panel__row-top");
      if (!top) throw new Error("ligne sans bande de contenu");
      return top.getBoundingClientRect().bottom;
    };

    // ---- L'ÉCART, ligne enfant de tête par ligne enfant de tête ----
    const firsts = rows.filter((row) => row.querySelector(".layer-panel__rail--first") !== null);
    // DEUX groupes : un sous le fond, un sous la photo. Si ce compte tombe, la
    // mesure ci-dessous ne balaye plus les deux formes de parent.
    await expect(firsts).toHaveLength(2);
    for (const child of firsts) {
      const rail = child.querySelector<HTMLElement>(".layer-panel__rail--first")!;
      // Le parent d'une ligne enfant de tête est la ligne juste AU-DESSUS dans
      // la liste (sens causal, ADR-0004 ; groupes contigus, layerTree.ts).
      const parent = rows[rows.indexOf(child) - 1];
      const gap = rail.getBoundingClientRect().top - contentBottom(parent);
      // Zéro, pas « petit » : le filet rejoint son parent ou il ne le rejoint
      // pas. La tolérance ne couvre que l'arrondi sous-pixel du navigateur.
      await expect(Math.abs(gap)).toBeLessThan(0.5);
    }

    // ---- ET LES SEGMENTS SE REJOIGNENT ----
    // Corollaire : remonter le seul segment de tête ne doit pas décrocher les
    // suivants. Le bas d'un filet touche le haut de celui de la ligne suivante.
    const rails = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__rail"));
    await expect(rails).toHaveLength(2); // un enfant par groupe ici
    for (const rail of rails) {
      // Chaque groupe n'ayant qu'un enfant, chaque filet est à la fois de tête
      // et de queue : il s'arrête au bas du contenu de SA propre ligne.
      const own = rail.closest<HTMLElement>(".layer-panel__row")!;
      await expect(Math.abs(rail.getBoundingClientRect().bottom - contentBottom(own))).toBeLessThan(0.5);
    }
  },
};

// LE test qui manquait, n°3 (2026-07-29). Constat d'Antoine à l'écran : « le
// calque actif bouffe l'espace du lien » — le filet d'imbrication disparaissait
// là où il croise une ligne SÉLECTIONNÉE.
//
// CE QUE LA MESURE A ÉCARTÉ. La première hypothèse — le lavis de sélection
// PEINT PAR-DESSUS le filet — est FAUSSE, et le `z-index` posé pour la corriger
// était un no-op. Relevé au hit-test (`elementFromPoint`, que la spécification
// dérive de l'ordre de peinture), AVEC puis SANS ce `z-index` : le filet
// ressort dans les deux cas, sur toute la portion qui recouvre la ligne
// sélectionnée. Il est l'enfant d'une ligne qui peint après ses voisines — il
// était déjà au-dessus.
//
// LA CAUSE RÉELLE est le CONTRASTE. `--border-default` est un blanc à 11 %
// d'opacité (relevé : `color(srgb 0.949 0.949 0.949 / 0.11)`) ; le lavis de
// sélection est bien plus clair que la surface du panneau (relevé :
// `color(srgb 0.2318 0.2667 0.3711)`), et 11 % de blanc par-dessus n'y produit
// presque aucun écart. Le filet ne disparaît pas SOUS le lavis : il se dissout
// DEDANS.
//
// La mesure porte donc sur le rapport de contraste entre le filet COMPOSÉ sur
// son fond et ce fond, au seuil WCAG des éléments d'interface non textuels
// (3:1). C'est ce que l'œil constate, et c'est ce qui retombe au rouge si le
// correctif est retiré.
const RAIL_MIN_CONTRAST = 3;

/** `color(srgb r g b / a)` ou `rgb(...)`/`rgba(...)` -> canaux en 0..255 et
 *  alpha en 0..1. Le navigateur rend l'une ou l'autre forme selon que la valeur
 *  vient d'un `color-mix()` ou d'un littéral. */
function parseColor(value: string): [number, number, number, number] {
  const numbers = value.match(/-?\d*\.?\d+/g);
  if (!numbers || numbers.length < 3) throw new Error(`couleur illisible: ${value}`);
  const [a, b, c, d] = numbers.map(Number);
  const scale = value.startsWith("color(") ? 255 : 1;
  return [a * scale, b * scale, c * scale, d === undefined ? 1 : d];
}

/** Source-over d'une couleur translucide sur un fond opaque. */
function composite(front: [number, number, number, number], back: [number, number, number, number]): number[] {
  return [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3]));
}

/** Contraste WCAG entre deux couleurs opaques. */
function contrastRatio(x: number[], y: number[]): number {
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((channel) => {
      const v = channel / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export const RailStaysVisibleUnderSelection: Story = {
  // La ligne SÉLECTIONNÉE est la photo de FOND, et le filet de l'effet juste en
  // dessous remonte dans son padding bas (`--first`, 8 px sur le lavis) : c'est
  // le croisement filet/sélection le plus courant à l'écran, le fond étant la
  // ligne qu'on sélectionne en ouvrant un document.
  args: { layers: twoParentKinds, selectedId: "layer-background" },
  decorators: [dockWidthDecorator],
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__row"));
    await expect(rows).toHaveLength(4);
    const selected = rows[0];
    await expect(selected.className).toContain("layer-panel__row--selected");

    const rail = rows[1].querySelector<HTMLElement>(".layer-panel__rail--first");
    if (!rail) throw new Error("la ligne sous la sélection devrait porter un filet de tête");

    // ---- LE CROISEMENT EXISTE BIEN ----
    // Sans ce bloc, la mesure de contraste porterait peut-être sur un filet qui
    // ne touche jamais le lavis, et ne prouverait rien.
    const railBox = rail.getBoundingClientRect();
    const selectedBox = selected.getBoundingClientRect();
    const overlap = Math.min(railBox.bottom, selectedBox.bottom) - Math.max(railBox.top, selectedBox.top);
    await expect(overlap).toBeGreaterThan(0);

    // ---- ET LE FILET Y RESTE LISIBLE ----
    const railColor = parseColor(getComputedStyle(rail).backgroundColor);
    const washColor = parseColor(getComputedStyle(selected).backgroundColor);
    const ratio = contrastRatio(composite(railColor, washColor), washColor.slice(0, 3));
    await expect(ratio).toBeGreaterThanOrEqual(RAIL_MIN_CONTRAST);

    // ---- ET LE DÉBORDEMENT VERS LE BAS NE CROISE RIEN ----
    // C'est ce qui justifie de ne traiter que DEUX cas en CSS plutôt que
    // d'essayer d'exprimer « la ligne suivante est sélectionnée », que CSS ne
    // sait pas dire : le bas d'un filet s'arrête dans la gouttière de liste.
    await expect(railBox.bottom).toBeLessThanOrEqual(rows[2].getBoundingClientRect().top);
  },
};

// L'ALLURE AU REPOS NE BOUGE PAS. Le correctif est scopé à la sélection : sans
// cette story, relever le filet PARTOUT passerait au vert — et un connecteur
// décoratif au rang d'un texte serait un bruit visuel sur toute la liste.
export const RailKeepsItsRestingRank: Story = {
  args: { layers: twoParentKinds, selectedId: null },
  decorators: [dockWidthDecorator],
  play: async ({ canvasElement }) => {
    const rails = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__rail"));
    await expect(rails.length).toBeGreaterThan(0);
    // Résolution du token par le navigateur lui-même : comparer à une chaîne
    // écrite en dur ici ferait passer le test au vert si `--border-default`
    // changeait de valeur sans que le filet suive.
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--border-default)";
    canvasElement.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    for (const rail of rails) {
      await expect(getComputedStyle(rail).backgroundColor).toBe(expected);
    }
  },
};

// --- Verrou (arbitrage n°2 du design du 2026-07-28) ---

// Le CADENAS de la ligne n'est plus un contrôle depuis le 2026-07-29 : c'est un
// MARQUEUR, et il n'apparaît QUE sur les lignes verrouillées. Justification
// (point 5 de la checklist ADR-0001) : un verrou posé est un état qu'on doit
// pouvoir balayer sans sélectionner chaque calque ; un verrou ouvert n'est rien
// à voir, et le montrer partout coûtait une colonne de 28 px prise au nom.
export const LockedLayerShowsMarkerOnly: Story = {
  args: {
    layers: [backgroundLayer(), makeLayer({ id: "layer-1", effectId: "glow", locked: true }), makeLayer({ id: "layer-2", effectId: "grain" })],
    selectedId: "layer-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // UN seul cadenas de calque, sur la seule ligne verrouillée — et c'est une
    // image, pas un bouton : l'action vit dans la zone de contrôles.
    const marker = canvas.getByRole("img", { name: "Calque verrouillé" });
    await expect(marker.closest("button")).toBeNull();
    await expect(canvas.getAllByRole("img", { name: "Calque verrouillé" })).toHaveLength(1);
    // UN SEUL LIBELLÉ DÉSORMAIS. « Arrière-plan verrouillé » a disparu avec la
    // ligne dérivée : le fond n'a plus de statut immuable à annoncer, il porte
    // le même verrou ordinaire que les autres, et ne l'a pas ici.
    await expect(canvas.queryByRole("img", { name: "Arrière-plan verrouillé" })).toBeNull();
  },
};

// Et le fond se VERROUILLE comme n'importe quel calque : c'est l'autre moitié
// de l'arbitrage n°2 — plus verrouillé par défaut, mais verrouillable.
export const BackgroundCanBeLocked: Story = {
  args: {
    layers: [
      makeLayer({ ...backgroundLayer(), locked: true }),
      makeLayer({ id: "layer-1", effectId: "glow" }),
    ],
    selectedId: "layer-background",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvasElement.querySelector<HTMLElement>('[data-layer-row-index="0"]')!;
    // Même marqueur, même libellé que sur un calque d'effet : le verrou est une
    // propriété de calque, pas un statut d'arrière-plan.
    await expect(within(row).getByRole("img", { name: "Calque verrouillé" })).toBeTruthy();
    await expect(canvas.getAllByRole("img", { name: "Calque verrouillé" })).toHaveLength(1);
  },
};

// L'ABSENCE est la moitié du contrat : une pile sans verrou ne montre aucun
// cadenas de calque. Sans cette story, rendre le marqueur en permanence
// passerait au vert.
export const UnlockedLayersShowNoLock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("img", { name: "Calque verrouillé" })).toHaveLength(0);
  },
};
