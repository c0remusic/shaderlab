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
    onClipChange: () => {},
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
    const expected = [
      "Écrêter sur la photo du dessus",
      ...getEffect("glow").params.flatMap((p) => [p.label, `${p.label} (valeur)`]),
    ];
    await expect(report.map((entry) => entry.name)).toEqual(expected);
  },
};

/** Calque photo (`passthrough`) : état vide EXPLICITE, plus un `Disclosure`
 *  vide (design 2026-07-27 §3.7). */
export const PassthroughLayer: Story = {
  args: { layer: makeLayer({ id: "layer-photo", effectId: "passthrough", params: {} }) },
};

/** Régression : un calque ÉCRÊTÉ repassé à « Aucun effet » doit garder sa case
 *  d'écrêtage. L'état vide était retourné AVANT la case, donc l'utilisateur ne
 *  pouvait plus la décocher — piège sans issue hors undo. L'écrêtage est une
 *  propriété du CALQUE, pas de son effet. */
export const ClippedLayerWithoutEffectKeepsClipToggle: Story = {
  args: { layer: makeLayer({ id: "layer-5", effectId: "passthrough", params: {}, clipToBelow: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("checkbox", { name: "Écrêter sur la photo du dessus" });
    await expect(toggle).toBeChecked();
    await expect(canvas.getByText("Aucun effet appliqué à ce calque.")).toBeInTheDocument();
  },
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

/** Écrêtage déjà posé : la case d'en-tête est cochée. */
export const ClippedLayer: Story = {
  args: { layer: makeLayer({ id: "layer-4", clipToBelow: true }) },
};

/** Calque PHOTO : la bascule d'écrêtage n'est pas rendue du tout — c'est le
 *  calque d'effet qui porte l'attribut, une photo ne peut pas être écrêtée. */
export const PhotoLayerHasNoClipToggle: Story = {
  args: {
    layer: makeLayer({
      id: "layer-5",
      effectId: "passthrough",
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox", { name: "Écrêter sur la photo du dessus" })).toBeNull();
  },
};

/** Calque VERROUILLÉ : tout contrôle dont la mutation est refusée par
 *  `LayerStack.isLocked` (`setLayerClip`, `updateParams`) est rendu INERTE, et
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
    layer: makeLayer({ id: "layer-locked", effectId: "duotone", params: { contrast: 0.8 }, locked: true }),
    onParamChange: fn(),
    onClipChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Le panneau DIT pourquoi il est inerte, sans coûter une ligne de hauteur.
    await expect(canvas.getByTitle("Calque verrouillé")).toBeInTheDocument();

    // 1. Écrêtage (`setLayerClip` refuse) — inerte, mais sa valeur reste lue.
    const clip = canvas.getByRole("checkbox", { name: "Écrêter sur la photo du dessus" });
    await expectInert(clip);
    await expect(clip).not.toBeChecked();

    // 2. Tous les curseurs de paramètres (`updateParams` refuse), groupés
    //    comme simples. `getAllBy*` échoue si la liste est vide : le compte
    //    non nul est prouvé, pas supposé (règle « un scan qui ne trouve rien
    //    doit prouver qu'il a balayé »).
    const sliders = canvas.getAllByRole("slider");
    await expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) await expectInert(slider);

    // 3. La pastille de couleur ouvre un sélecteur qui ÉCRIT des params —
    //    inerte elle aussi, sinon le picker piloterait dans le vide.
    const pastilleOmbres = canvas.getByRole("button", { name: "Ouvrir le sélecteur de couleur pour Ombres" });
    await expectInert(pastilleOmbres);

    // 4. LISIBILITÉ : désactivé ne veut dire ni caché ni vidé.
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

    // 5. Clavier : un contrôle inerte ne se pilote pas non plus au clavier.
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
    await expectLive(canvas.getByRole("checkbox", { name: "Écrêter sur la photo du dessus" }));
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
 *  (les huit réglages de pavé de `glass`). Le gain est de la HAUTEUR : huit
 *  lignes deviennent quatre. */
export const GabaritGrille: Story = {
  render: () => (
    <SectionSeule label="Pavé" layout="grille"
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

export const ToggleClipFiresChange: Story = {
  args: { layer: glowLayer, onClipChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: "Écrêter sur la photo du dessus" }));
    await expect(args.onClipChange).toHaveBeenCalledWith("layer-1", true);
  },
};

export const ChangeParamFiresChange: Story = {
  args: { layer: glowLayer, onParamChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // "Seuil" is the label of the glow `threshold` param; its numeric input is
    // labeled "Seuil (valeur)". Enter commits parsed value → onParamChange.
    const input = canvas.getByLabelText("Seuil (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    await userEvent.keyboard("{Enter}");
    // Enter must commit exactly once. Regression guard: Enter previously
    // called commitTypedValue() AND blur() (whose onBlur re-commits),
    // firing onParamChange twice per Enter.
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { threshold: 0.5 });
  },
};
