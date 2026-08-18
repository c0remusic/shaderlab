import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TransformHandles } from "./TransformHandles";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import type { LayerTransform } from "../layers/types";

/** Taille du FOND, en pixels — l'unité de `LayerTransform.x/y` et celle des
 *  pas de déplacement au clavier. */
const BG = { width: 1000, height: 800 };
const PHOTO = { width: 400, height: 300 };
const BASE_TRANSFORM: LayerTransform = { x: 500, y: 400, scaleX: 1, scaleY: 1, rotation: 0 };

/**
 * `TransformHandles` mesure le rectangle AFFICHÉ d'un vrai `<canvas>` et se
 * cale dessus (`measureOverlay`) : sans canvas monté ni parent positionné, il
 * ne rend rien du tout. Ce harnais fournit les deux — c'est la condition pour
 * que la story existe, pas un décor.
 *
 * Aucun contexte WebGPU n'est créé : le composant ne lit que
 * `getBoundingClientRect()` et `canvas.width/height`. La story tourne donc en
 * chromium headless, contrairement au rendu de l'app (voir CLAUDE.md, § Moyen
 * de preuve).
 */
function Harness({
  transform = BASE_TRANSFORM,
  layerName = "IMG_1234.jpg",
  onTransformChange = () => {},
  onTransformCommit = () => {},
}: {
  transform?: LayerTransform;
  layerName?: string | null;
  onTransformChange?: (t: LayerTransform) => void;
  onTransformCommit?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    // `position: relative` obligatoire : l'overlay est absolu et se mesure
    // contre son `offsetParent`.
    <div style={{ position: "relative", width: 500, height: 400 }}>
      <canvas ref={canvasRef} width={BG.width} height={BG.height} style={{ width: "100%", height: "100%" }} />
      <TransformHandles
        transform={transform}
        photoSize={PHOTO}
        bgSize={BG}
        canvasRef={canvasRef}
        layerName={layerName}
        onTransformChange={onTransformChange}
        onTransformCommit={onTransformCommit}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Components/TransformHandles",
  component: Harness,
};

export default meta;
type Story = StoryObj<typeof Harness>;

/** Le cadre focusable, seule cible clavier de l'overlay. */
function frame(canvasElement: HTMLElement): SVGPolygonElement {
  return within(canvasElement).getByRole("application") as unknown as SVGPolygonElement;
}

export const Default: Story = {};

export const RotatedAndScaled: Story = {
  args: { transform: { x: 500, y: 400, scaleX: 1.6, scaleY: 0.8, rotation: Math.PI / 6 } },
};

// --- Accessibilité (play) ---

/**
 * GARDE D'ACCESSIBILITÉ — la raison d'être de ce fichier.
 *
 * `assertAccessibleNames` est le garde-fou du projet, mais il est piloté par
 * les stories : un composant SANS story n'est jamais balayé. C'est exactement
 * ce qui a laissé cet overlay sans le moindre `aria-label` jusqu'au
 * 2026-07-31, alors que le panneau Photo, lui, était couvert.
 *
 * Sélecteur EXPLICITE : le cadre n'est pas un contrôle de formulaire, il ne
 * tombe donc pas dans `CONTROL_SELECTOR`. Le passer en clair vaut mieux
 * qu'élargir le sélecteur par défaut pour un cas qui n'existe qu'ici.
 */
export const FrameHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement, '[role="application"]');
    await expect(report).toHaveLength(1);
    // Le nom dit DE QUELLE photo il s'agit (deux photos = deux cadres) et
    // annonce la touche, puisque rien d'autre à l'écran ne le fait.
    await expect(report[0].name).toContain("IMG_1234.jpg");
    await expect(report[0].name).toContain("flèches");
  },
};

/** Les neuf pastilles sont des affordances de SOURIS, retirées de l'arbre
 *  d'accessibilité à dessein : les annoncer sans les rendre actionnables au
 *  clavier promettrait neuf contrôles dont aucun ne répondrait. */
export const OnlyTheFrameIsReachableByTab: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(document.activeElement).toBe(frame(canvasElement));
    // Un second Tab sort de l'overlay : aucune pastille ne s'intercale.
    await userEvent.tab();
    await expect(document.activeElement).not.toBe(frame(canvasElement));
  },
};

// --- Déplacement au clavier (play) ---

export const ArrowNudgesOnePixel: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onTransformChange).toHaveBeenCalledWith({ ...BASE_TRANSFORM, x: 501 });
    await userEvent.keyboard("{ArrowUp}");
    // Y CROISSANT VERS LE BAS (repère du fond) : la flèche haut retranche.
    await expect(args.onTransformChange).toHaveBeenCalledWith({ ...BASE_TRANSFORM, y: 399 });
  },
};

export const ShiftArrowNudgesTenPixels: Story = {
  args: { onTransformChange: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await expect(args.onTransformChange).toHaveBeenCalledWith({ ...BASE_TRANSFORM, x: 490 });
  },
};

/**
 * UN APPUI MAINTENU = UNE entrée d'historique.
 *
 * Le témoin porte sur ce qui casserait vraiment : committer sur chaque
 * `keydown` produirait une entrée par répétition du clavier (une dizaine par
 * seconde), et `Ctrl+Z` deviendrait inutilisable. Le commit est donc sur le
 * `keyup`, qui ne part qu'une fois.
 */
export const HeldArrowCommitsOnce: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    // `{ArrowRight>4/}` : un appui, quatre `keydown` (dont 3 répétitions), un
    // seul relâchement — soit exactement la forme d'un appui maintenu.
    await userEvent.keyboard("{ArrowRight>4/}");
    await expect(args.onTransformChange).toHaveBeenCalledTimes(4);
    await expect(args.onTransformCommit).toHaveBeenCalledTimes(1);
  },
};

/** `Échap` REND LE FOCUS, il n'annule pas la transformation : cet overlay n'est
 *  pas une session modale à la Photoshop (il est affiché en permanence et
 *  chaque geste committe déjà), l'annulation reste `Ctrl+Z`. Quitter l'outil
 *  est le Échap global d'`App.tsx`, qui reçoit l'évènement par bouillonnement. */
export const EscapeReleasesFocus: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await expect(document.activeElement).toBe(frame(canvasElement));
    await userEvent.keyboard("{Escape}");
    await expect(document.activeElement).not.toBe(frame(canvasElement));
    await expect(args.onTransformChange).not.toHaveBeenCalled();
    await expect(args.onTransformCommit).not.toHaveBeenCalled();
  },
};

/**
 * LE CLIC DU MILIEU N'EST PAS UN GESTE DE DOCUMENT.
 *
 * `Canvas.isPanGesture` le traite comme un déplacement de la VUE. Le cadre
 * étant posé au-dessus du canvas, il l'interceptait et déplaçait la photo —
 * soit l'exact contraire du geste demandé.
 */
export const MiddleButtonDoesNotMoveThePhoto: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const box = frame(canvasElement);
    await userEvent.pointer([
      { keys: "[MouseMiddle>]", target: box as unknown as Element },
      { target: box as unknown as Element, coords: { clientX: 260, clientY: 200 } },
      { keys: "[/MouseMiddle]" },
    ]);
    await expect(args.onTransformChange).not.toHaveBeenCalled();
    await expect(args.onTransformCommit).not.toHaveBeenCalled();
  },
};

/** Sans nom de calque (cas d'une photo importée jamais nommée), le cadre garde
 *  un nom accessible utilisable — le garde le vérifie, il ne se contente pas
 *  d'un libellé non vide. */
export const UnnamedLayerStillHasAName: Story = {
  args: { layerName: null },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement, '[role="application"]');
    await expect(report[0].name).toBe("Cadre de transformation — flèches pour déplacer, Maj+flèches par pas de 10 px");
  },
};


/**
 * LA POIGNEE S'ATTRAPE, ET ELLE LE DIT — les deux ecarts mesures du ticket 17.
 *
 * Les quatre overlays de toile partageaient trois defauts IDENTIQUES : aucune
 * regle `:hover`, une taille de 12 px contre 24x24 recommandes, et le token du
 * POUCE DE CURSEUR (`--slider-thumb-size`) reutilise pour une poignee de
 * manipulateur — donc agrandir l'une aurait grossi tous les curseurs du dock.
 *
 * DEUX MESURES, ET LA DISTINCTION EST LE FOND DU SUJET. Ce qu'on VOIT reste a
 * 12 px : une poignee de 24 px peinte sur une petite forme la recouvrirait.
 * Ce qu'on ATTRAPE fait 24 px, par un pseudo-element transparent qui deborde.
 * La recommandation porte sur la CIBLE, jamais sur la peinture.
 *
 * Attendus DERIVES des tokens, jamais des litteraux : changer un token doit
 * changer ce test avec lui, pas le faire mentir.
 */
export const HandlesAreGrabbableAndSayIt: Story = {
  play: async ({ canvasElement }) => {
    const poignee = canvasElement.querySelector<HTMLElement>(".canvas-handle");
    await expect(poignee).not.toBeNull();
    const racine = getComputedStyle(document.documentElement);
    const taille = parseFloat(racine.getPropertyValue("--canvas-handle-size"));
    const cible = parseFloat(racine.getPropertyValue("--canvas-handle-target"));
    await expect(cible).toBeGreaterThan(taille);

    // Ce qu'on VOIT : la taille visible, pas la cible.
    const boite = poignee!.getBoundingClientRect();
    await expect(Math.round(boite.width)).toBe(taille);

    // Ce qu'on ATTRAPE : le pseudo-element deborde de la moitie de l'ecart de
    // chaque cote, donc la cible totale vaut le token.
    const apres = getComputedStyle(poignee!, "::after");
    const debord = parseFloat(apres.top);
    await expect(taille - 2 * debord).toBeCloseTo(cible, 1);

    // Et elle ANNONCE sa prise : sans retour au survol, il faut essayer pour
    // savoir qu'un manipulateur est attrapable.
    //
    // ⚠️ LU DANS LE CSSOM, et pas par `userEvent.hover`. Un `:hover` CSS suit la
    // position REELLE du pointeur ; les evenements de survol synthetiques ne
    // l'activent pas, donc un test qui passerait par eux verifierait toujours
    // l'etat de repos en croyant mesurer le survol. On demande donc a la feuille
    // CHARGEE si la regle existe — ce qui distingue une regle vivante d'une
    // ligne presente dans un fichier jamais importe.
    const regles = Array.from(document.styleSheets).flatMap((feuille) => {
      try {
        return Array.from(feuille.cssRules);
      } catch {
        return [];
      }
    });
    const survol = regles.filter(
      (r): r is CSSStyleRule =>
        r instanceof CSSStyleRule && r.selectorText.includes(".canvas-handle:hover"),
    );
    await expect(survol.length).toBeGreaterThan(0);
    await expect(survol.some((r) => r.style.transform !== "")).toBe(true);
  },
};
