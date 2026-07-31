import { describe, expect, it } from "vitest";
import { IDLE_CANVAS_MODE } from "../../src/ui/canvasMode";
import {
  TOOLS,
  activeTool,
  isToolShortcutEvent,
  selectTool,
  toolFromShortcut,
  type ToolState,
} from "../../src/ui/tools";

const IDLE: ToolState = { mode: IDLE_CANVAS_MODE, erase: false, handTool: false };

const keyEvent = (code: string, over: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "repeat", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...over,
});

describe("TOOLS — table de la palette", () => {
  it("n'a ni identifiant ni raccourci en double", () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.shortcut)).size).toBe(TOOLS.length);
  });

  it("désigne les touches par leur code physique, pas par le caractère produit", () => {
    // `key` dépend de la disposition clavier : sur AZERTY, la même touche sous
    // le doigt ne produit pas la même lettre. `code` reste stable.
    //
    // La liste énumère les FAMILLES de `code` que la palette a le droit
    // d'utiliser, et pas seulement `Key[A-Z]` : la main est passée sur Espace
    // le 2026-07-31, dont le `code` est « Space ». Une regex de la seule forme
    // des lettres tombait au rouge sur un code parfaitement valide — elle
    // vérifiait la forme d'un exemple, pas la propriété visée. Ce qui compte
    // est qu'aucune valeur ne soit un CARACTÈRE (un `key`) ; les codes à un
    // seul caractère sont donc ce que ce motif exclut.
    for (const tool of TOOLS) expect(tool.shortcut).toMatch(/^(Key[A-Z]|Digit[0-9]|Space)$/);
  });

  it("n'expose PAS le recadrage — il n'a pas de géométrie derrière", () => {
    expect(TOOLS.map((t) => t.id)).not.toContain("crop");
  });
});

describe("activeTool — un outil est toujours actif", () => {
  it("rend Déplacer au repos", () => {
    expect(activeTool(IDLE)).toBe("move");
  });

  it("distingue pinceau et gomme par le seul drapeau d'effacement", () => {
    expect(activeTool({ mode: { kind: "maskPaint" }, erase: false, handTool: false })).toBe("brush");
    expect(activeTool({ mode: { kind: "maskPaint" }, erase: true, handTool: false })).toBe("eraser");
  });

  it("la main l'emporte sur la peinture (elle neutralise vraiment le geste)", () => {
    expect(activeTool({ mode: { kind: "maskPaint" }, erase: false, handTool: true })).toBe("hand");
  });

  it("un mode crop retombe sur Déplacer plutôt que sur aucun outil", () => {
    const cropping: ToolState = {
      mode: { kind: "crop", layerId: "l1", original: undefined },
      erase: false,
      handTool: false,
    };
    expect(activeTool(cropping)).toBe("move");
  });
});

describe("selectTool", () => {
  it("est un aller-retour avec activeTool pour chaque outil", () => {
    for (const tool of TOOLS) {
      expect(activeTool(selectTool(tool.id, IDLE))).toBe(tool.id);
    }
  });

  it("la main sort du mode peinture au lieu de le garder sous elle", () => {
    // Sinon le curseur de pinceau reste affiché et le canvas en `cursor: none`
    // pendant un geste qui ne peint pas.
    const painting: ToolState = { mode: { kind: "maskPaint" }, erase: false, handTool: false };
    expect(selectTool("hand", painting).mode).toEqual(IDLE_CANVAS_MODE);
  });

  it("Déplacer quitte la peinture", () => {
    const painting: ToolState = { mode: { kind: "maskPaint" }, erase: true, handTool: false };
    const moved = selectTool("move", painting);
    expect(moved.mode).toEqual(IDLE_CANVAS_MODE);
    expect(moved.handTool).toBe(false);
  });

  it("Déplacer et Main préservent le sens d'effacement pour le retour au pinceau", () => {
    const erasing: ToolState = { mode: { kind: "maskPaint" }, erase: true, handTool: false };
    expect(selectTool("move", erasing).erase).toBe(true);
    expect(selectTool("hand", erasing).erase).toBe(true);
  });

  it("aucun outil ne produit main + peinture simultanément", () => {
    for (const tool of TOOLS) {
      const next = selectTool(tool.id, { mode: { kind: "maskPaint" }, erase: true, handTool: true });
      expect(next.handTool && next.mode.kind === "maskPaint").toBe(false);
    }
  });
});

describe("raccourcis clavier", () => {
  it("associe chaque touche déclarée à son outil", () => {
    for (const tool of TOOLS) expect(toolFromShortcut(tool.shortcut)).toBe(tool.id);
  });

  it("ignore une touche non déclarée", () => {
    expect(toolFromShortcut("KeyZ")).toBeNull();
    expect(isToolShortcutEvent(keyEvent("KeyZ"))).toBe(false);
  });

  it("accepte une frappe nue", () => {
    expect(isToolShortcutEvent(keyEvent("KeyB"))).toBe(true);
  });

  it("refuse les combinaisons à modificateur — elles appartiennent à l'app", () => {
    expect(isToolShortcutEvent(keyEvent("KeyB", { ctrlKey: true }))).toBe(false);
    expect(isToolShortcutEvent(keyEvent("KeyE", { metaKey: true }))).toBe(false);
    expect(isToolShortcutEvent(keyEvent("KeyV", { altKey: true }))).toBe(false);
  });

  it("refuse l'auto-répétition", () => {
    expect(isToolShortcutEvent(keyEvent("KeyB", { repeat: true }))).toBe(false);
  });
});
