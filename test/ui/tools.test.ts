import { describe, expect, it } from "vitest";
import { IDLE_CANVAS_MODE } from "../../src/ui/canvasMode";
import {
  DEFAULT_TOOL,
  TOOLS,
  activeTool,
  escapeAction,
  isQuitToolEvent,
  isTextEntryTarget,
  isToolShortcutEvent,
  selectTool,
  toolFromShortcut,
  type ToolState,
} from "../../src/ui/tools";

const IDLE: ToolState = { mode: IDLE_CANVAS_MODE, erase: false };
const TARGET = { layerId: "l1", sourceId: "brush-1" };

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
    // d'utiliser plutôt que la seule forme `Key[A-Z]` : vérifier la forme d'un
    // exemple, ce n'est pas vérifier la propriété visée. Ce qui compte est
    // qu'aucune valeur ne soit un CARACTÈRE (un `key`) ; les codes à un seul
    // caractère sont donc ce que ce motif exclut.
    for (const tool of TOOLS) expect(tool.shortcut).toMatch(/^(Key[A-Z]|Digit[0-9]|Space)$/);
  });

  it("n'expose PAS le recadrage — il n'a pas de géométrie derrière", () => {
    expect(TOOLS.map((t) => t.id)).not.toContain("crop");
  });

  it("n'expose PAS la main — déplacer la vue est une parenthèse, pas un outil", () => {
    // Retiré le 2026-07-31 au soir après une journée d'existence. Le geste vit
    // dans `Canvas` (Espace maintenu) : il rend l'outil précédent au
    // relâchement, parce qu'on ne l'a jamais quitté.
    expect(TOOLS.map((t) => t.id)).not.toContain("hand");
    // Et Espace ne désigne donc plus aucun outil : sans ça, l'écouteur de
    // raccourcis d'`App.tsx` continuerait d'intercepter Espace et de
    // `preventDefault` par-dessus le geste de `Canvas`.
    expect(toolFromShortcut("Space")).toBeNull();
  });
});

describe("activeTool — un outil est toujours actif", () => {
  it("rend Déplacer au repos", () => {
    expect(activeTool(IDLE)).toBe("move");
  });

  it("distingue pinceau et gomme par le seul drapeau d'effacement", () => {
    expect(activeTool({ mode: { kind: "maskPaint", ...TARGET }, erase: false })).toBe("brush");
    expect(activeTool({ mode: { kind: "maskPaint", ...TARGET }, erase: true })).toBe("eraser");
  });

  it("un mode crop retombe sur Déplacer plutôt que sur aucun outil", () => {
    const cropping: ToolState = {
      mode: { kind: "crop", layerId: "l1", original: undefined },
      erase: false,
    };
    expect(activeTool(cropping)).toBe("move");
  });
});

describe("selectTool", () => {
  it("est un aller-retour avec activeTool pour chaque outil", () => {
    for (const tool of TOOLS) {
      expect(activeTool(selectTool(tool.id, IDLE, TARGET))).toBe(tool.id);
    }
  });

  it("Déplacer quitte la peinture", () => {
    const painting: ToolState = { mode: { kind: "maskPaint", ...TARGET }, erase: true };
    expect(selectTool("move", painting).mode).toEqual(IDLE_CANVAS_MODE);
  });

  it("Déplacer préserve le sens d'effacement pour le retour au pinceau", () => {
    const erasing: ToolState = { mode: { kind: "maskPaint", ...TARGET }, erase: true };
    expect(selectTool("move", erasing).erase).toBe(true);
  });

  it("seul le pinceau et la gomme entrent en mode peinture", () => {
    for (const tool of TOOLS) {
      const painting = selectTool(tool.id, { mode: { kind: "maskPaint", ...TARGET }, erase: true }, TARGET);
      expect(painting.mode.kind === "maskPaint").toBe(tool.id === "brush" || tool.id === "eraser");
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

describe("Échap quitte l'outil", () => {
  it("ramène sur un outil qui existe, et sur celui du repos", () => {
    // `DEFAULT_TOOL` doit rester un membre de la palette : une constante qui
    // désignerait un outil absent laisserait la palette sans bouton actif.
    expect(TOOLS.map((t) => t.id)).toContain(DEFAULT_TOOL);
    expect(activeTool(IDLE)).toBe(DEFAULT_TOOL);
  });

  it("reconnaît la frappe nue", () => {
    expect(isQuitToolEvent(keyEvent("Escape"))).toBe(true);
  });

  it("ne se déclenche sur aucune autre touche", () => {
    // Y COMPRIS les raccourcis d'outil : les deux gardes lisent le même
    // évènement dans le même écouteur, un recouvrement rendrait l'ordre des
    // tests significatif.
    for (const tool of TOOLS) expect(isQuitToolEvent(keyEvent(tool.shortcut))).toBe(false);
    expect(isQuitToolEvent(keyEvent("KeyZ"))).toBe(false);
  });

  it("refuse les combinaisons à modificateur — Ctrl+Échap appartient à Windows", () => {
    expect(isQuitToolEvent(keyEvent("Escape", { ctrlKey: true }))).toBe(false);
    expect(isQuitToolEvent(keyEvent("Escape", { metaKey: true }))).toBe(false);
    expect(isQuitToolEvent(keyEvent("Escape", { altKey: true }))).toBe(false);
  });

  it("refuse l'auto-répétition", () => {
    expect(isQuitToolEvent(keyEvent("Escape", { repeat: true }))).toBe(false);
  });

  it("sortir de la peinture par Échap donne le même état que choisir Déplacer", () => {
    const painting: ToolState = { mode: { kind: "maskPaint", ...TARGET }, erase: true };
    expect(selectTool(DEFAULT_TOOL, painting).mode).toEqual(IDLE_CANVAS_MODE);
  });

  it("défait une couche à la fois : l'outil d'abord, la sélection ensuite", () => {
    // Depuis le pinceau, Échap range le pinceau SANS toucher au calque : celui
    // qui voulait ranger son outil n'a pas à re-choisir son calque ensuite.
    expect(escapeAction("brush", true)).toBe("quitTool");
    expect(escapeAction("eraser", true)).toBe("quitTool");
    // Une fois sur Déplacer, le second Échap désélectionne.
    expect(escapeAction("move", true)).toBe("deselect");
  });

  it("quitte l'outil même sans sélection — les deux couches sont indépendantes", () => {
    expect(escapeAction("brush", false)).toBe("quitTool");
  });

  it("ne fait rien quand il n'y a plus rien à défaire", () => {
    expect(escapeAction("move", false)).toBe("none");
  });

  it("chaque outil de la palette finit par rendre la main en deux Échap au plus", () => {
    // Propriété de TERMINAISON : une cascade qui pourrait boucler laisserait
    // l'utilisateur coincé. Deux coups suffisent depuis n'importe quel état.
    for (const tool of TOOLS) {
      const premier = escapeAction(tool.id, true);
      const second = premier === "quitTool" ? escapeAction(DEFAULT_TOOL, true) : escapeAction(DEFAULT_TOOL, false);
      expect([premier, second]).toContain("deselect");
    }
  });

  it("un raccourci passe depuis un curseur, jamais depuis un champ de texte", () => {
    // LE BUG DU 2026-08-27 : la garde disait tag === "INPUT" tout court, et un
    // range GARDE le focus après un réglage à la souris — la palette devenait
    // muette après le geste le plus fréquent de l'app. Reproduit par sonde CDP
    // avant correction : focus range, V envoyé, outil inchangé.
    const cible = (tag: string, inputType?: string, editable = false) =>
      isTextEntryTarget({ tag, inputType, isContentEditable: editable });
    // Non textuels : les raccourcis passent.
    expect(cible("INPUT", "range")).toBe(false);
    expect(cible("INPUT", "checkbox")).toBe(false);
    expect(cible("INPUT", "color")).toBe(false);
    expect(cible("BODY")).toBe(false);
    expect(cible("BUTTON")).toBe(false);
    // Textuels : les raccourcis se taisent.
    expect(cible("INPUT", "text")).toBe(true);
    expect(cible("INPUT", "number")).toBe(true);
    expect(cible("INPUT", "search")).toBe(true);
    expect(cible("TEXTAREA")).toBe(true);
    expect(cible("SELECT")).toBe(true);
    expect(cible("DIV", undefined, true)).toBe(true);
    // Type inconnu ou absent : BLOQUANT, le sens sûr — avaler un raccourci
    // coûte un agacement, écrire un « v » dans un champ coûte une donnée.
    expect(cible("INPUT", "un-type-futur")).toBe(true);
    expect(cible("INPUT")).toBe(true);
  });

  it("Échap n'entre pas en conflit avec le geste de déplacement", () => {
    // Espace n'est plus un raccourci d'outil : les deux touches vivent dans
    // des écouteurs différents (`App.tsx` pour Échap, `Canvas.tsx` pour Espace)
    // et aucune n'est réclamée par les deux.
    expect(isQuitToolEvent(keyEvent("Space"))).toBe(false);
    expect(isToolShortcutEvent(keyEvent("Space"))).toBe(false);
  });
});
