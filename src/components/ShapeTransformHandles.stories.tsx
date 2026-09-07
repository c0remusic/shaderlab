import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { ShapeTransformHandles } from "./ShapeTransformHandles";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import type { ShapeBox } from "../ui/shapeDraw";

/** Le canvas AFFICHÉ, en pixels — l'overlay se cale dessus (`measureOverlay`)
 *  et convertit les deltas d'écran en fractions du cadre. */
const CANVAS = { width: 1000, height: 800 };
/** Défaut de la source `shape` (`mask/sources/shape.ts`). */
const BOITE: ShapeBox = { x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.7 };

/**
 * `ShapeTransformHandles` mesure un vrai `<canvas>` : sans canvas ni parent
 * positionné, il ne rend rien. Ce harnais fournit les deux. Aucun WebGPU — le
 * composant ne lit que `getBoundingClientRect()`, donc la story tourne en
 * chromium headless (voir CLAUDE.md § Moyen de preuve).
 */
function Harness({
  box = BOITE,
  effectName = "Éclat",
  onChange = () => {},
  onCommit = () => {},
}: {
  box?: ShapeBox;
  effectName?: string;
  onChange?: (box: ShapeBox) => void;
  onCommit?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <div style={{ position: "relative", width: 500, height: 400 }}>
      <canvas ref={canvasRef} width={CANVAS.width} height={CANVAS.height} style={{ width: "100%", height: "100%" }} />
      <ShapeTransformHandles
        box={box}
        canvasSize={CANVAS}
        canvasRef={canvasRef}
        effectName={effectName}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Components/ShapeTransformHandles",
  component: Harness,
};

export default meta;
type Story = StoryObj<typeof Harness>;

function frame(canvasElement: HTMLElement): SVGRectElement {
  return within(canvasElement).getByRole("application") as unknown as SVGRectElement;
}

/** La pastille de DROITE (côté `e`) : sur la boîte par défaut elle est à
 *  x = 75 % (le bord droit de la boîte). */
function rightHandle(canvasElement: HTMLElement): HTMLElement {
  const handles = Array.from(canvasElement.querySelectorAll<HTMLElement>(".effect-transform-handles__handle"));
  const droite = handles.find((h) => h.style.left === "75%" && h.style.top === "50%");
  if (!droite) throw new Error("pastille droite introuvable");
  return droite;
}

export const Default: Story = {};

/** Une boîte fine près du coin haut-gauche — les huit pastilles suivent ses
 *  bords min/max. */
export const SmallBox: Story = {
  args: { box: { x0: 0.1, y0: 0.15, x1: 0.35, y1: 0.4 } },
};

// --- Accessibilité (play) ---

/** Le cadre porte un nom accessible qui dit DE QUELLE forme il s'agit et annonce
 *  la touche — il est la seule cible clavier de l'overlay. */
export const FrameHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement, '[role="application"]');
    await expect(report).toHaveLength(1);
    await expect(report[0].name).toContain("Éclat");
    await expect(report[0].name).toContain("flèches");
  },
};

/** Les huit pastilles sont des affordances de SOURIS, retirées de l'arbre
 *  d'accessibilité : seul le cadre se prend au Tab. */
export const OnlyTheFrameIsReachableByTab: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(document.activeElement).toBe(frame(canvasElement));
    await userEvent.tab();
    await expect(document.activeElement).not.toBe(frame(canvasElement));
  },
};

// --- Clavier (play) ---

/** Les flèches DÉPLACENT la boîte (les bords se règlent aux curseurs du panneau
 *  Masque) — droite décale de +0,01, largeur et hauteur inchangées. */
export const ArrowMovesTheBox: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    const calls = (args.onChange as ReturnType<typeof fn>).mock.calls;
    const last = calls[calls.length - 1]?.[0] as ShapeBox;
    await expect(last.x0).toBeCloseTo(0.26, 6);
    await expect(last.x1).toBeCloseTo(0.76, 6);
    await expect(last.y0).toBeCloseTo(0.3, 6);
    await expect(last.y1).toBeCloseTo(0.7, 6);
  },
};

/** Un appui MAINTENU = UNE entrée d'historique (commit sur le keyup, qui ne part
 *  qu'une fois), même raison que `EffectTransformHandles`. */
export const HeldArrowCommitsOnce: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{ArrowRight>4/}");
    await expect(args.onChange).toHaveBeenCalledTimes(4);
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
  },
};

/** `Échap` REND LE FOCUS, il ne déplace rien et ne committe rien. */
export const EscapeReleasesFocus: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await expect(document.activeElement).toBe(frame(canvasElement));
    await userEvent.keyboard("{Escape}");
    await expect(document.activeElement).not.toBe(frame(canvasElement));
    await expect(args.onChange).not.toHaveBeenCalled();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

// --- Souris (play) ---

/**
 * TIRER LA PASTILLE DE DROITE ÉCRIT LE BORD DROIT (x1), le bord gauche reste
 * fixe. Glissement de +50 px sur un canvas affiché à 500 px = 0,1 de fraction,
 * donc x1 = 0,75 + 0,1 = 0,85. Le geste committe au relâchement, une seule fois.
 */
export const DraggingRightHandleWritesRightEdge: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const handle = rightHandle(canvasElement);
    // `setPointerCapture` n'existe pas sur l'élément en test : on le neutralise,
    // comme `EffectTransformHandles.stories`.
    handle.setPointerCapture = () => {};
    const canvas = canvasElement.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    const start = { x: rect.left + rect.width * 0.75, y: rect.top + rect.height / 2 };
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: start.x, clientY: start.y });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: start.x + rect.width * 0.1, clientY: start.y });
    const calls = (args.onChange as ReturnType<typeof fn>).mock.calls;
    const last = calls[calls.length - 1]?.[0] as ShapeBox;
    await expect(last.x1).toBeCloseTo(0.85, 2);
    await expect(last.x0).toBeCloseTo(0.25, 6);
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: start.x + rect.width * 0.1, clientY: start.y });
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
  },
};
