import { describe, expect, it } from "vitest";
import {
  inMemoryWorkspaceLayoutStore,
  loadWorkspaceLayout,
  parseWorkspaceLayout,
  serializeWorkspaceLayout,
  WORKSPACE_LAYOUT_VERSION,
} from "../../src/ui/workspaceLayoutStore";
import { singleGroup, type DockLayout } from "../../src/ui/dockLayout";

/**
 * La disposition de l'espace de travail survit au redémarrage depuis le
 * 2026-09-15 (arbitrage d'Antoine). Avant, elle vivait dans un `useState` seul,
 * et `migrateDockLayout` — écrit, testé dix fois — affirmait en commentaire
 * qu'elle était PERSISTÉE tout en n'ayant aucun appelant : la fonction et ses
 * tests se validaient mutuellement, hors de tout chemin vivant.
 *
 * Ces cas éprouvent la LECTURE, qui est toute la substance du module, sans
 * Tauri ni navigateur — c'est ce que le port achète.
 */

const clamp = (w: number): number => Math.min(400, Math.max(240, w));

const dock: DockLayout = [
  [{ tabs: ["presets", "properties"], active: "properties", collapsed: false }, singleGroup("develop")],
  [singleGroup("layers")],
];

describe("serializeWorkspaceLayout / parseWorkspaceLayout", () => {
  it("fait l'aller-retour sans rien perdre — onglets, actif, repli, largeur", () => {
    const brut = serializeWorkspaceLayout({ dock, dockWidth: 300 });
    expect(parseWorkspaceLayout(brut, clamp)).toEqual({ dock, dockWidth: 300 });
  });

  it("écrit la version du FORMAT, pour qu'une migration future sache d'où elle part", () => {
    expect(JSON.parse(serializeWorkspaceLayout({ dock, dockWidth: 320 })).version).toBe(WORKSPACE_LAYOUT_VERSION);
  });

  it("lit l'ANCIENNE forme `string[][]`, celle d'avant les groupes à onglets", () => {
    // C'est la raison d'être de `migrateDockLayout`, restée jusqu'ici sans
    // aucun chemin vivant pour l'exercer.
    const ancien = JSON.stringify({ version: 1, dock: [["presets"], ["layers"]], dockWidth: 320 });
    const lu = parseWorkspaceLayout(ancien, clamp);
    expect(lu?.dock).toEqual([[singleGroup("presets")], [singleGroup("layers")]]);
  });

  it("REVALIDE l'onglet actif : un actif absent de son groupe ne rendrait aucun contenu", () => {
    const menteur = JSON.stringify({
      version: 1,
      dock: [[{ tabs: ["presets", "properties"], active: "disparu", collapsed: false }]],
      dockWidth: 320,
    });
    expect(parseWorkspaceLayout(menteur, clamp)?.dock[0][0].active).toBe("presets");
  });

  it("BORNE la largeur lue, jamais ne l'honore telle quelle", () => {
    const large = JSON.stringify({ version: 1, dock: [[singleGroup("layers")]], dockWidth: 9999 });
    expect(parseWorkspaceLayout(large, clamp)?.dockWidth).toBe(400);
  });

  describe("écarte tout ce qui ne se lit pas, pour que l'appelant retombe sur la disposition d'usine", () => {
    const illisibles: Array<[string, string]> = [
      ["JSON invalide", "{pas du json"],
      ["tableau au lieu d'un objet", "[]"],
      ["null", "null"],
      ["dock absent", JSON.stringify({ version: 1, dockWidth: 320 })],
      ["dock vide", JSON.stringify({ version: 1, dock: [], dockWidth: 320 })],
      ["colonne sans onglet", JSON.stringify({ version: 1, dock: [[{ tabs: [] }]], dockWidth: 320 })],
      ["onglets non textuels", JSON.stringify({ version: 1, dock: [[{ tabs: [7] }]], dockWidth: 320 })],
      ["largeur absente", JSON.stringify({ version: 1, dock: [[singleGroup("layers")]] })],
      ["largeur NaN", JSON.stringify({ version: 1, dock: [[singleGroup("layers")]], dockWidth: null })],
    ];
    for (const [nom, brut] of illisibles) {
      it(nom, () => {
        expect(parseWorkspaceLayout(brut, clamp)).toBeNull();
      });
    }
  });
});

describe("loadWorkspaceLayout", () => {
  it("rend `null` au PREMIER lancement — rien d'enregistré n'est pas une erreur", async () => {
    expect(await loadWorkspaceLayout(inMemoryWorkspaceLayoutStore(null), clamp)).toBeNull();
  });

  it("rend la disposition enregistrée", async () => {
    const store = inMemoryWorkspaceLayoutStore(serializeWorkspaceLayout({ dock, dockWidth: 260 }));
    expect(await loadWorkspaceLayout(store, clamp)).toEqual({ dock, dockWidth: 260 });
  });

  it("laisse remonter un échec de LECTURE, qui est un incident et pas un défaut de contenu", async () => {
    const casse = {
      async read(): Promise<string | null> {
        throw new Error("Lecture de la disposition échouée: accès refusé");
      },
      async write() {},
    };
    await expect(loadWorkspaceLayout(casse, clamp)).rejects.toThrow(/Lecture de la disposition/);
  });

  it("le double en mémoire garde ce qu'on lui écrit — c'est le second adaptateur du port", async () => {
    const store = inMemoryWorkspaceLayoutStore();
    await store.write(serializeWorkspaceLayout({ dock, dockWidth: 280 }));
    expect(await loadWorkspaceLayout(store, clamp)).toEqual({ dock, dockWidth: 280 });
  });
});
