import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { ParamPanel, ParamSection } from "./ParamPanel";
import { LabeledSlider } from "./ui/labeled-slider";
import type { SectionLayout } from "../render/effects/types";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import { getEffect } from "../render/effects/registry";
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

const glowLayer = makeLayer({ effectId: "glow", params: { threshold: 0.7, intensity: 1.2 } });

/** Un contrôle INERTE, quelle que soit la primitive qui le rend.
 *
 *  `toBeDisabled()` ne connaît que les éléments de formulaire NATIFS. La case
 *  Base UI est un `<span role="checkbox">` : elle porte `aria-disabled` et
 *  `tabindex="-1"` mais aucun attribut `disabled`, et `toBeDisabled()` la
 *  déclarerait active à tort. On vérifie donc les deux formes — et
 *  `tabindex="-1"` est la preuve directe que la NAVIGATION CLAVIER saute le
 *  contrôle, ce qu'un simple `disabled` sur un natif garantit par ailleurs. */
async function expectInert(el: HTMLElement) {
  if (el.hasAttribute("aria-disabled")) {
    await expect(el).toHaveAttribute("aria-disabled", "true");
    await expect(el).toHaveAttribute("tabindex", "-1");
    return;
  }
  await expect(el).toBeDisabled();
}

/** Miroir de `expectInert` : le contrôle est réellement actionnable. */
async function expectLive(el: HTMLElement) {
  if (el.hasAttribute("aria-disabled")) {
    await expect(el).toHaveAttribute("aria-disabled", "false");
    return;
  }
  await expect(el).toBeEnabled();
}

const meta: Meta<typeof ParamPanel> = {
  title: "Components/ParamPanel",
  component: ParamPanel,
  args: {
    layer: glowLayer,
    onParamChange: () => {},
    onParamCommit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ParamPanel>;

export const Default: Story = {};

export const NoLayerSelected: Story = {
  args: { layer: null },
};

/** GARDE D'ACCESSIBILITÉ — balayage MESURÉ des contrôles de paramètres
 *  (`LabeledSlider` : une piste + son champ de valeur par paramètre). Le
 *  balayage doit trouver au moins un contrôle par paramètre de l'effet, sinon
 *  il est vert pour la mauvaise raison — voir
 *  `ui/accessible-name.test-support.ts`. */
export const EveryFieldHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    // DÉRIVÉE du module d'effet, pas recopiée. Une liste écrite à la main
    // tombait au rouge à chaque paramètre ajouté à `glow` sans qu'aucune
    // régression d'accessibilité ne la motive (c'est ce qui est arrivé le
    // 2026-07-31 : quatre paramètres de plus, garde rouge, CI rouge). Dérivée,
    // elle dit ce qu'elle veut vraiment dire — CHAQUE paramètre de l'effet a
    // une piste nommée et un champ de valeur nommé — et elle le dira encore
    // après le prochain paramètre.
    const expected = getEffect("glow").params.flatMap((p) => [p.label, `${p.label} (valeur)`]);
    await expect(report.map((entry) => entry.name)).toEqual(expected);
  },
};

/** Calque photo (`passthrough`) : état vide EXPLICITE, plus un `Disclosure`
 *  vide (design 2026-07-27 §3.7). */
export const PassthroughLayer: Story = {
  args: { layer: makeLayer({ id: "layer-photo", effectId: "passthrough", params: {} }) },
};

export const WarpLayer: Story = {
  args: { layer: makeLayer({ id: "layer-2", effectId: "warp" }) },
};

export const GrainLayer: Story = {
  args: { layer: makeLayer({ id: "layer-3", effectId: "grain" }) },
};

/** Paramètre à CHOIX DISCRET (`EffectParam.choices`) — le mode du grain. Cette
 *  story existe pour une raison précise : la valeur reste un NOMBRE côté modèle
 *  (l'uniform est un `array<f32>`), et tout l'intérêt du type est que
 *  l'utilisateur ne voie jamais ce nombre. Un curseur à pas 1 aurait fonctionné
 *  mécaniquement en affichant « 0 » et « 1 ». */
export const DiscreteChoiceParamShowsNames: Story = {
  args: { layer: makeLayer({ id: "layer-mode", effectId: "grain" }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Base UI Select.Trigger expose le rôle "combobox".
    const trigger = canvas.getByRole("combobox", { name: "Type" });
    // Le défaut est l'index 0 : il doit se lire par son NOM, jamais « 0 ».
    await expect(trigger).toHaveTextContent("Analogique (argentique)");
    await expect(trigger).not.toHaveTextContent("0");
  },
};

/** Choisir un mode remonte son INDEX, et valide immédiatement l'historique —
 *  un choix est un geste atomique, pas un glissement : sans commit, il ne serait
 *  jamais annulable seul et s'agrégerait au prochain relâchement de curseur. */
export const DiscreteChoiceFiresIndexAndCommits: Story = {
  args: { layer: makeLayer({ id: "layer-mode", effectId: "grain" }), onParamChange: fn(), onParamCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Type" }));
    // Les options s'ouvrent dans un PORTAIL hors de canvasElement — `screen`.
    await userEvent.click(await screen.findByRole("option", { name: "Numérique (capteur)" }));
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-mode", { mode: 1 });
    await expect(args.onParamCommit).toHaveBeenCalledTimes(1);
  },
};

/** Calque VERROUILLÉ : tout contrôle dont la mutation est refusée par
 *  `LayerStack.isLocked` (`updateParams`) est rendu INERTE, et
 *  ses valeurs restent LISIBLES — le verrou empêche de modifier, pas de
 *  consulter. Le « pourquoi » passe par `title` sur la racine du panneau, pas
 *  par une ligne de texte : la hauteur des cartes est sous budget (ADR-0001).
 *
 *  Effet `duotone` : c'est le seul du registre qui porte à la fois des
 *  paramètres GROUPÉS (ColorGroupControl, pastille + 3 curseurs) et des
 *  paramètres simples (contraste, pivot) — les deux chemins de rendu de
 *  `groupEffectParams` sont donc couverts par une seule story. */
export const LockedLayer: Story = {
  args: {
    layer: makeLayer({ id: "layer-locked", effectId: "duotone", params: { contrast: 0.8 }, locks: { all: true } }),
    onParamChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Le panneau DIT pourquoi il est inerte, sans coûter une ligne de hauteur.
    await expect(canvas.getByTitle("Calque verrouillé")).toBeInTheDocument();

    // 1. Tous les curseurs de paramètres (`updateParams` refuse), groupés
    //    comme simples. `getAllBy*` échoue si la liste est vide : le compte
    //    non nul est prouvé, pas supposé (règle « un scan qui ne trouve rien
    //    doit prouver qu'il a balayé »).
    const sliders = canvas.getAllByRole("slider");
    await expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) await expectInert(slider);

    // 2. La pastille de couleur ouvre un sélecteur qui ÉCRIT des params —
    //    inerte elle aussi, sinon le picker piloterait dans le vide.
    const pastilleOmbres = canvas.getByRole("button", { name: "Ouvrir le sélecteur de couleur pour Ombres" });
    await expectInert(pastilleOmbres);

    // 3. LISIBILITÉ : désactivé ne veut dire ni caché ni vidé.
    const contrast = canvas.getByLabelText("Contraste (écrasement) (valeur)");
    await expectInert(contrast);
    await expect(contrast).toHaveValue("80 %");
    // ⚠️ REQUÊTE PORTÉE SUR LA LIGNE DE LA PASTILLE, et non sur tout le panneau.
    //    Un `getByText("Ombres")` global a levé « Found multiple elements » le
    //    2026-08-05 : `duotone` avait reçu une section par encre, titrée du même
    //    mot que la pastille qu'elle contient. Les trois sections ont été
    //    retirées depuis (voir `duotone.ts`), donc la requête globale
    //    repasserait — on garde la portée quand même, parce que ce qu'on veut
    //    prouver ici est que le LIBELLÉ DE LA PASTILLE reste lu sous verrou, et
    //    qu'un titre de section voisin n'a pas à pouvoir y répondre à sa place.
    await expect(within(pastilleOmbres.parentElement!).getByText("Ombres")).toBeInTheDocument();

    // 4. Clavier : un contrôle inerte ne se pilote pas non plus au clavier.
    sliders[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onParamChange).not.toHaveBeenCalled();
  },
};

/** Contre-épreuve de `LockedLayer` : le MÊME calque non verrouillé garde tous
 *  ses contrôles actifs. Sans elle, `LockedLayer` passerait aussi si le panneau
 *  désactivait tout en permanence. */
export const UnlockedLayerKeepsControlsActive: Story = {
  args: {
    layer: makeLayer({ id: "layer-unlocked", effectId: "duotone", params: { contrast: 0.8 } }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTitle("Calque verrouillé")).toBeNull();
    for (const slider of canvas.getAllByRole("slider")) await expectLive(slider);
    await expectLive(canvas.getByRole("button", { name: "Ouvrir le sélecteur de couleur pour Ombres" }));
  },
};

// --- Gabarits de section (SectionLayout) ---

/** Une section isolée dans le chrome réel du panneau — c'est lui qui porte les
 *  classes dont dépendent les gabarits.
 *
 *  POURQUOI PAS UN EFFET DU REGISTRE. Aucun n'en déclare encore : les sections
 *  arrivent effet par effet dans une tâche ultérieure, et `ParamPanel` va
 *  chercher son module par `getEffect(layer.effectId)` — il n'y a donc rien à
 *  injecter. Ces stories montrent le RÉGIME, qui est justement tout ce qu'un
 *  gabarit choisit ; ce que chaque effet y range se verra sur les siennes. */
function SectionSeule({ label, layout, curseurs }: { label: string; layout: SectionLayout; curseurs: readonly string[] }) {
  return (
    <div className="param-panel" style={{ width: "var(--inspector-width-default)" }}>
      <div className="param-panel__group">
        <ParamSection label={label} layout={layout}>
          {curseurs.map((nom, index) => (
            <LabeledSlider key={nom} label={nom} value={0.2 + index * 0.1} min={0} max={1} step={0.01} onChange={() => {}} />
          ))}
        </ParamSection>
      </div>
    </div>
  );
}

/** Deux tracks de grille, mesurées sur le style CALCULÉ. Une story de mise en
 *  page qui se contente d'exister est une image : elle reste verte si la feuille
 *  ne se charge pas, si la classe est mal orthographiée, ou si un gabarit tombe
 *  en colonne — les trois façons dont un gabarit échoue. */
async function attendreDeuxColonnes(canvasElement: HTMLElement) {
  const corps = canvasElement.querySelector<HTMLElement>(".param-panel__section-body");
  await expect(corps).not.toBeNull();
  const style = getComputedStyle(corps!);
  await expect(style.display).toBe("grid");
  await expect(style.gridTemplateColumns.split(/\s+/).filter(Boolean)).toHaveLength(2);
}

/** GABARIT `paire` — deux curseurs liés lus comme un seul réglage coupé en
 *  deux (`blackPoint`/`whitePoint`, qui traîne dans cinq effets). */
export const GabaritPaire: Story = {
  render: () => <SectionSeule label="Tonalité" layout="paire" curseurs={["Point noir", "Point blanc"]} />,
  play: async ({ canvasElement }) => attendreDeuxColonnes(canvasElement),
};

/** GABARIT `grille` — curseurs courts en deux colonnes, pour les blocs longs
 *  (les neuf réglages de la section « Matière » de `glass`). Le gain est de la
 *  HAUTEUR : huit rangées deviennent quatre lignes.
 *
 *  ⚠️ Ce commentaire a cité les huit réglages de PAVÉ de `glass` jusqu'au
 *  2026-08-27 ; ils sont partis avec les cinq matières (ADR-0021). La story,
 *  elle, ne lit aucun module — ses curseurs sont écrits à la main et ne
 *  décrivent aucun effet réel : ce qu'elle éprouve est le GABARIT, pas son
 *  occupant. */
export const GabaritGrille: Story = {
  render: () => (
    <SectionSeule label="Bloc" layout="grille"
      curseurs={["Largeur", "Hauteur", "Chanfrein", "Mortier", "Décalage", "Irrégularité", "Grain", "Relief"]} />
  ),
  play: async ({ canvasElement }) => attendreDeuxColonnes(canvasElement),
};

/** GABARIT `liste` — le défaut, une ligne par curseur : c'est ce que rend tout
 *  effet sans section (voir `Default`, `WarpLayer`). En story explicite pour
 *  que la contre-épreuve des deux gabarits ci-dessus existe : sans elle, une
 *  règle qui mettrait TOUTE section en grille passerait inaperçue. */
export const GabaritListe: Story = {
  render: () => <SectionSeule label="Détection" layout="liste" curseurs={["Seuil", "Épaisseur", "Lissage"]} />,
  play: async ({ canvasElement }) => {
    const corps = canvasElement.querySelector<HTMLElement>(".param-panel__section-body");
    await expect(corps).not.toBeNull();
    await expect(getComputedStyle(corps!).display).toBe("flex");
    await expect(getComputedStyle(corps!).flexDirection).toBe("column");
  },
};

// --- Interaction tests (play) ---

export const ChangeParamFiresChange: Story = {
  args: { layer: glowLayer, onParamChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // "Seuil" is the label of the glow `threshold` param; its numeric input is
    // labeled "Seuil (valeur)". Enter commits parsed value → onParamChange.
    // `threshold` est un paramètre `percent` : le champ montre « 70 % », la
    // frappe se lit donc en POURCENTS (« 50 » → 0.5) — la story tapait « 0.5 »
    // du temps où la saisie passait, à tort, par les bornes fraction.
    const input = canvas.getByLabelText("Seuil (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "50");
    await userEvent.keyboard("{Enter}");
    // Enter must commit exactly once. Regression guard: Enter previously
    // called commitTypedValue() AND blur() (whose onBlur re-commits),
    // firing onParamChange twice per Enter.
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { threshold: 0.5 });
  },
};

/**
 * GABARIT `grille` — AUCUN LIBELLE NE TRONQUE A LA LARGEUR REELLE DU DOCK.
 *
 * Quatre sections sont passees de `liste` a `grille` le 2026-08-18 (ticket 16) :
 * deux colonnes tiennent le meme nombre de reglages en deux fois moins de
 * lignes, ce qui etait le vrai levier du front — pas le decoupage.
 *
 * Une demi-largeur a un prix, et `channelMixer` l'a deja documente en REFUSANT
 * `grille` : « Rouge <- Vert n'est pas un libelle court, et l'encre est une
 * pastille repliable, pas un curseur. Deux colonnes etroites tronqueraient les
 * uns et deformeraient l'autre. » Le meme raisonnement a fait garder `liste` sur
 * `outlines.encre`, qui porte deux pastilles.
 *
 * Restait a EPROUVER les quatre qui passent. Le plus long libelle du lot est
 * « Remplissage des fantomes », 24 caracteres. Ce test le rend a 320 px — la
 * largeur par defaut du dock (`--inspector-width-default`) — et exige qu'aucun
 * libelle ne deborde sa boite.
 *
 * Le seuil est DERIVE (`scrollWidth > clientWidth`), jamais un nombre de pixels
 * ecrit en dur : un litteral se perimerait au premier changement de gabarit,
 * comme les deux seuils de `LayerPanel` en 2026-08-16.
 */
export const GrilleLabelsDoNotTruncate: Story = {
  args: {
    layer: makeLayer({ effectId: "lensFlare", params: { ghostsOn: 1, diffusionOn: 1, sensorOn: 0 } }),
  },
  decorators: [
    (Story) => (
      <div style={{ width: "var(--inspector-width-default)" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const grilles = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".param-panel__section--grille"),
    );
    await expect(grilles.length).toBeGreaterThan(0);
    const tronques = grilles
      .flatMap((g) => Array.from(g.querySelectorAll<HTMLElement>("label")))
      .filter((l) => l.scrollWidth > l.clientWidth)
      .map((l) => l.textContent);
    await expect(tronques).toEqual([]);
  },
};


/**
 * DOUBLE-CLIC POUR REVENIR AU DEFAUT, et MARQUE du defaut sur la piste — les
 * deux mecanismes adoptes au ticket 11 le 2026-08-18, construits le meme jour.
 *
 * La marque n'apparait QUE lorsque la valeur a quitte son defaut. C'est
 * l'enrichissement demande par Antoine devant la planche : la montrer en
 * permanence ferait un point de plus a lire sur chaque ligne d'un panneau qui
 * en compte deja trop.
 *
 * ⚠️ Le test ne compte pas les marques contre un LITTERAL. Il rend DEUX
 * panneaux — l'un a ses defauts, l'autre non — et exige zero marque d'un cote,
 * au moins une de l'autre. Un seuil ecrit en dur se perimerait au premier
 * parametre ajoute a `glow`.
 */
export const DefaultMarkerAppearsOnlyOffDefault: Story = {
  render: () => (
    <>
      <div data-testid="au-defaut">
        <ParamPanel layer={makeLayer({ effectId: "glow", params: {} })} onParamChange={() => {}} onParamCommit={() => {}} onOpenColorPicker={() => {}} />
      </div>
      <div data-testid="hors-defaut">
        <ParamPanel layer={glowLayer} onParamChange={() => {}} onParamCommit={() => {}} onOpenColorPicker={() => {}} />
      </div>
    </>
  ),
  play: async ({ canvasElement }) => {
    const marques = (id: string) =>
      within(canvasElement).getByTestId(id).querySelectorAll("[data-marque-defaut]").length;
    await expect(marques("au-defaut")).toBe(0);
    await expect(marques("hors-defaut")).toBeGreaterThan(0);
  },
};

/**
 * CONTRÔLES SPATIAUX EN PIXELS (voie B, symétrie panneau/toile — tranchée le
 * 2026-08-19). Quand `imageSize` est réel, un paramètre spatial (position,
 * étendue, rayon) s'affiche en PIXELS, du même nombre que la toile — plus en
 * fraction. La rotation reste en DEGRÉS : c'est déjà une unité qu'on ne convertit
 * pas.
 *
 * `aplat` porte une boîte (`box`) : centre, largeur, hauteur, rotation. On la
 * rend à 6000×4000, où `centreX = 0.5` doit se lire « 3000 px », `largeur = 0.4 »
 * « 2400 px » (× LARGEUR), et `rotation` rester « 0° ». `borne = 1` rend le bloc
 * visible (les contrôles de forme sont conditionnés par un mode ≠ « aucune »).
 */
export const SpatialControlsShowPixels: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.5, centreY: 0.5, largeur: 0.4, hauteur: 0.4, rotation: 0 } }),
    imageSize: { width: 6000, height: 4000 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Position × LARGEUR, étendue × LARGEUR — le même facteur que la toile.
    await expect(canvas.getByLabelText("Centre X (valeur)")).toHaveValue("3000 px");
    await expect(canvas.getByLabelText("Largeur (valeur)")).toHaveValue("2400 px");
    // Hauteur × HAUTEUR : 0.4 × 4000 = 1600 px, pas 2400 — l'axe compte.
    await expect(canvas.getByLabelText("Hauteur (valeur)")).toHaveValue("1600 px");
    // La rotation n'est PAS convertie : elle reste en degrés.
    await expect(canvas.getByLabelText("Rotation (valeur)")).toHaveValue("0°");
  },
};

/** Contre-épreuve : SANS `imageSize` (aucun document), le même paramètre reste
 *  en POURCENTAGE. Sans elle, une conversion toujours active passerait la story
 *  ci-dessus tout en cassant les panneaux ordinaires.
 *
 *  Une décimale, et elle n'est pas cosmétique : `centreX` a un pas de 0,001 et
 *  `largeur` de 0,005, donc le champ MONTRE ce que le curseur sait régler (voir
 *  `FineStepPercentShowsItsPrecisionAndHoldsOnBlur`). */
export const SpatialControlsStayPercentWithoutImageSize: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.5, largeur: 0.4 } }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Centre X (valeur)")).toHaveValue("50.0 %");
    await expect(canvas.getByLabelText("Largeur (valeur)")).toHaveValue("40.0 %");
  },
};

/** Saisie en PIXELS : le champ accepte des pixels, les ramène en fraction (la
 *  seule chose stockée, ce qui garde les presets indépendants de la définition)
 *  et remonte la fraction. Taper « 1500 » dans Centre X à 6000 px de large donne
 *  0.25. */
export const SpatialPixelInputConvertsToFraction: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.5, largeur: 0.4 } }),
    imageSize: { width: 6000, height: 4000 },
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Centre X (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "1500");
    await userEvent.keyboard("{Enter}");
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { centreX: 0.25 });
  },
};

/** Saisie en POURCENTS : un paramètre `percent` montre « 50 % » pendant que son
 *  curseur reste en fraction, la frappe se lit donc en pourcents et se stocke en
 *  fraction. Taper « 60 » donne 0.6 — sans le parse par unité, elle passait par
 *  les bornes FRACTION du curseur et s'écrêtait à 1 (= 100 %). Bug préexistant
 *  trouvé par l'audit de la voie B (ROADMAP, 2026-08-20). */
export const PercentInputConvertsToFraction: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.5, largeur: 0.4 } }),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Centre X (valeur)");
    await expect(input).toHaveValue("50.0 %");
    await userEvent.clear(input);
    await userEvent.type(input, "60");
    await userEvent.keyboard("{Enter}");
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { centreX: 0.6 });
  },
};

/** Contre-épreuve du même bug : focus puis blur SANS frapper ne change RIEN.
 *  Avant le parse par unité, le brouillon « 50 % » repassait par les bornes
 *  fraction au blur et posait 1 (= 100 %) — la valeur sautait à son maximum
 *  sans qu'aucun chiffre ait été tapé. */
export const PercentFieldRoundTripsOnBlur: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.5, largeur: 0.4 } }),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Centre X (valeur)"));
    await userEvent.tab();
    await expect(args.onParamChange).not.toHaveBeenCalled();
  },
};

/** L'affichage percent porte les décimales de SON PAS — et c'est ce qui éteint
 *  une dérive au blur. Le champ arrondissait au pourcent entier
 *  (`Math.round(value * 100)`) alors que 49 paramètres du registre ont un pas
 *  plus fin que 0,01 : `aplat.centreX` va par 0,001, donc 0,505 s'affichait
 *  « 50 % ». Deux conséquences, et la seconde mordait — le champ ne savait pas
 *  MONTRER ce que le curseur sait régler, et un focus + blur SANS frappe
 *  reparsait le brouillon gelé « 50 % » en 0,50 ≠ 0,505 : `onChange` et une
 *  entrée d'historique pour un geste nul. `PercentFieldRoundTripsOnBlur` ne
 *  l'attrapait pas, sa valeur (0,5) étant un multiple du pourcent.
 *
 *  Le round-trip est donc éprouvé sur une valeur que l'arrondi TRAHIT, seule
 *  forme qui distingue le correctif de son absence. */
export const FineStepPercentShowsItsPrecisionAndHoldsOnBlur: Story = {
  args: {
    layer: makeLayer({ effectId: "aplat", params: { borne: 1, centreX: 0.505, largeur: 0.4 } }),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Centre X (valeur)");
    await expect(input).toHaveValue("50.5 %");
    await userEvent.click(input);
    await userEvent.tab();
    await expect(args.onParamChange).not.toHaveBeenCalled();
  },
};

/** Même bug, TROISIÈME câblage : les curseurs Saturation/Luminosité d'un groupe
 *  de couleur (`ColorGroupControl`) affichent des % sur une fraction 0..1. Le
 *  groupe « Ombres » de `duotone` est le premier rendu, donc déplié d'entrée —
 *  son champ Saturation est le seul monté (les panneaux repliés ne sont pas
 *  dans le DOM). Taper « 60 » écrit 0.6, jamais 1. */
export const ColorGroupPercentInputConvertsToFraction: Story = {
  args: {
    layer: makeLayer({ effectId: "duotone" }),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Saturation (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "60");
    await userEvent.keyboard("{Enter}");
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { shadowSaturation: 0.6 });
  },
};

/** Contre-épreuve des bornes : l'écrêtage se fait dans l'espace AFFICHÉ. Taper
 *  « 150 » dans un percent borné à 1 donne le maximum (1, soit « 100 % »), pas
 *  1,5 — et pas non plus un écrêtage de « 150 » lu comme une fraction. Story
 *  héritée de la ligne parallèle du même fix (fd4538d), gardée au merge. */
export const PercentInputClampsInDisplaySpace: Story = {
  args: {
    layer: makeLayer({ effectId: "glow", params: { threshold: 0.5 } }),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Seuil (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.keyboard("{Enter}");
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { threshold: 1 });
  },
};

/** Double-cliquer sur le LIBELLE ramene au defaut, et en UN geste : une seule
 *  entree d'historique, comme un relachement de glissement. */
export const DoubleClickOnLabelResetsToDefault: Story = {
  args: { layer: glowLayer, onParamChange: fn(), onParamCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // `getByLabelText` viserait le curseur ; ici on veut le LIBELLE, et
    // « Seuil » est aussi le titre de la section de `glow` — d'ou la selection
    // par role plutot que par texte.
    await userEvent.dblClick(canvas.getByText("Seuil", { selector: "label" }));
    // 0.55 est le defaut declare par le module, jamais recopie dans ce test.
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { threshold: 0.55 });
    await expect(args.onParamCommit).toHaveBeenCalledTimes(1);
  },
};
