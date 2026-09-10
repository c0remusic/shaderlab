import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { EffectTransformHandles } from "./EffectTransformHandles";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import type { EffectTransform } from "../layers/types";

/** Le canvas AFFICHÉ, en pixels — l'overlay se cale dessus (`measureOverlay`)
 *  et convertit les deltas d'écran en fractions du cadre. */
const CANVAS = { width: 1000, height: 800 };
const CENTRE = { x: 0.5, y: 0.5 };

/**
 * `EffectTransformHandles` mesure un vrai `<canvas>` : sans canvas ni parent
 * positionné, il ne rend rien. Ce harnais fournit les deux. Aucun WebGPU — le
 * composant ne lit que `getBoundingClientRect()`, donc la story tourne en
 * chromium headless (voir CLAUDE.md § Moyen de preuve).
 */
function Harness({
  scale = { scaleX: 1, scaleY: 1 },
  anchor = CENTRE,
  effectName = "Fuite de lumière",
  onChange = () => {},
  onCommit = () => {},
}: {
  scale?: EffectTransform;
  anchor?: { x: number; y: number };
  effectName?: string;
  onChange?: (scale: EffectTransform) => void;
  onCommit?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <div style={{ position: "relative", width: 500, height: 400 }}>
      <canvas ref={canvasRef} width={CANVAS.width} height={CANVAS.height} style={{ width: "100%", height: "100%" }} />
      <EffectTransformHandles
        scale={scale}
        anchor={anchor}
        canvasRef={canvasRef}
        imageSize={CANVAS}
        effectName={effectName}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Components/EffectTransformHandles",
  component: Harness,
};

export default meta;
type Story = StoryObj<typeof Harness>;

function frame(canvasElement: HTMLElement): SVGRectElement {
  return within(canvasElement).getByRole("application") as unknown as SVGRectElement;
}

/** La pastille de DROITE (côté `e`) : à l'identité, elle est à x = 100 %. */
function rightHandle(canvasElement: HTMLElement): HTMLElement {
  const handles = Array.from(canvasElement.querySelectorAll<HTMLElement>(".effect-transform-handles__handle"));
  const droite = handles.find((h) => h.style.left === "100%");
  if (!droite) throw new Error("pastille droite introuvable");
  return droite;
}

export const Default: Story = {};

/** Étirée : scaleX 2 élargit, scaleY 0.4 aplatit — la boîte déborde en largeur
 *  et se resserre en hauteur autour de l'ancre centrale. */
export const Stretched: Story = {
  args: { scale: { scaleX: 2, scaleY: 0.4 } },
};

// --- Accessibilité (play) ---

/** Le cadre porte un nom accessible qui dit DE QUEL effet il s'agit et annonce
 *  la touche — il est la seule cible clavier de l'overlay. */
export const FrameHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement, '[role="application"]');
    await expect(report).toHaveLength(1);
    await expect(report[0].name).toContain("Fuite de lumière");
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

export const ArrowStretchesX: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    // Pas de 0,02 sur scaleX, scaleY inchangé.
    await expect(args.onChange).toHaveBeenCalledWith({ scaleX: 1.02, scaleY: 1 });
    await userEvent.keyboard("{ArrowUp}");
    // La flèche haut APLATIT (scaleY décroît).
    await expect(args.onChange).toHaveBeenLastCalledWith({ scaleX: 1, scaleY: 0.98 });
  },
};

/** Un appui MAINTENU = UNE entrée d'historique (commit sur le keyup, qui ne part
 *  qu'une fois), même raison que `TransformHandles`. */
export const HeldArrowCommitsOnce: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    frame(canvasElement).focus();
    await userEvent.keyboard("{ArrowRight>4/}");
    await expect(args.onChange).toHaveBeenCalledTimes(4);
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
  },
};

/** `Échap` REND LE FOCUS, il n'étire rien et ne committe rien : l'annulation est
 *  Ctrl+Z, quitter l'outil est le Échap global d'`App`. */
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
 * TIRER LA PASTILLE DE DROITE ÉLARGIT scaleX AUTOUR DE L'ANCRE.
 *
 * Ancre au centre : distance côté→ancre = 0,5. Un glissement de +50 px sur un
 * canvas affiché à 500 px = 0,1 de fraction, donc scaleX = 1 + 0,1/0,5 = 1,2.
 * Le geste committe au relâchement, une seule fois.
 */
export const DraggingRightHandleWidensX: Story = {
  args: { onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const handle = rightHandle(canvasElement);
    // `setPointerCapture` n'existe pas sur l'élément en test : on le neutralise,
    // comme `CurveControl.stories`.
    handle.setPointerCapture = () => {};
    const canvas = canvasElement.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    const start = { x: rect.left + rect.width, y: rect.top + rect.height / 2 };
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: start.x, clientY: start.y });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: start.x + rect.width * 0.1, clientY: start.y });
    const calls = (args.onChange as ReturnType<typeof fn>).mock.calls;
    const last = calls[calls.length - 1]?.[0] as EffectTransform;
    await expect(last.scaleX).toBeCloseTo(1.2, 2);
    await expect(last.scaleY).toBeCloseTo(1, 6);
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: start.x + rect.width * 0.1, clientY: start.y });
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
  },
};
