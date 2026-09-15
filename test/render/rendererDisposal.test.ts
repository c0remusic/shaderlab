import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde de DÉMONTAGE : tout module de `src/render/` que `Renderer` instancie et
 * qui possède des ressources GPU doit être relâché par `libererRessourcesGpu`.
 *
 * Pourquoi une garde qui lit les SOURCES plutôt qu'un test qui exécute.
 * Une fuite de VRAM est le seul genre de défaut que rien d'autre dans ce dépôt
 * ne peut voir : elle ne change AUCUN pixel, donc les références de rendu
 * restent vertes ; le compilateur ne compte pas les textures ; et le
 * `GPUDevice` ne meurt jamais — `initGpu` n'est appelé qu'une fois dans toute
 * l'application — donc rien ne rattrape l'oubli en aval. Or `App` fabrique un
 * `Renderer` NEUF à chaque ouverture de fichier : ce qu'un chemin de démontage
 * oublie est perdu pour la session entière.
 *
 * Ce que cette garde aurait attrapé, mesuré le 2026-09-15 :
 * - `TextureLibraryStore`, démonté par `allocateDocument` et absent de
 *   `dispose()` — jusqu'à six scans résidents, 268 Mo pièce en 8192² ;
 * - `FramePipelineExecutor`, démonté par NI L'UN NI L'AUTRE, si bien que
 *   `MippedSourceCache.dispose()` n'avait aucun appelant dans tout le dépôt.
 *
 * Les deux écarts entre les deux listes ÉTAIENT les deux fuites. La garde tient
 * donc sur la liste, pas sur les instances : un module GPU neuf est relâché par
 * les deux chemins ou par aucun, jamais par un seul.
 */

const RACINE_RENDU = join(process.cwd(), "src", "render");

/** Verbes de démontage réellement en usage dans cette couche. Ils sont DEUX et
 *  non un — `clearPipelines` chez `EffectPassRunner` et `PresentPass`, `dispose`
 *  partout ailleurs. La garde les accepte tous les deux plutôt que d'imposer un
 *  renommage qu'elle n'a pas à décider ; ce qu'elle exige, c'est qu'un verbe
 *  soit appelé, pas lequel. */
const VERBES = ["dispose", "clearPipelines"] as const;

function classesAvecDemontage(): Map<string, string[]> {
  const parClasse = new Map<string, string[]>();
  for (const fichier of readdirSync(RACINE_RENDU)) {
    if (!fichier.endsWith(".ts")) continue;
    const source = readFileSync(join(RACINE_RENDU, fichier), "utf8");
    const nom = /export class (\w+)/.exec(source)?.[1];
    if (!nom) continue;
    const verbes = VERBES.filter((v) => new RegExp(`^  ${v}\\(`, "m").test(source));
    if (verbes.length > 0) parClasse.set(nom, [...verbes]);
  }
  return parClasse;
}

describe("Renderer — un module GPU neuf ne peut pas être oublié par un seul chemin", () => {
  const source = readFileSync(join(RACINE_RENDU, "renderer.ts"), "utf8");
  const demontables = classesAvecDemontage();

  const corpsAllocation = /private allocateDocument\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  /** Modules RECONSTRUITS à chaque document, avec la classe construite.
   *
   *  C'est la bonne portée, et pas « tout ce que `Renderer` construit ».
   *  `ImageFrameResources` et `PresentPass` naissent dans le CONSTRUCTEUR et
   *  vivent autant que le renderer : le premier libère lui-même l'ancien jeu
   *  au début d'`allocateCanvas`, le second garde un cache de pipelines qui
   *  reste valide (même device, même format). Exiger leur libération à chaque
   *  document serait faux. L'invariant qui tient est plus étroit et plus sûr :
   *  QUI EN CONSTRUIT UN NEUF DOIT RELÂCHER L'ANCIEN. C'est exactement ce que
   *  les deux fuites violaient. */
  const reconstruits = [...corpsAllocation.matchAll(/this\.(\w+)\s*=\s*new (\w+)\(/g)].map(
    ([, champ, classe]) => ({ champ, classe }),
  );

  const corpsLiberation =
    /private libererRessourcesGpu\(\): void \{([\s\S]*?)\n  \}/.exec(source)?.[1];

  it("déclare une liste unique de libération", () => {
    expect(corpsLiberation).toBeDefined();
  });

  it("reconstruit au moins les six modules GPU connus à chaque document", () => {
    // Garde de SIGNAL : si les regex ci-dessus cessaient de matcher (renommage,
    // reformatage), la garde principale passerait au vert en n'inspectant rien.
    expect(reconstruits.length).toBeGreaterThanOrEqual(6);
    expect(demontables.size).toBeGreaterThanOrEqual(8);
  });

  it("relâche chaque module qu'il reconstruit et qui sait se démonter", () => {
    const oublies: string[] = [];
    for (const { champ, classe } of reconstruits) {
      const verbes = demontables.get(classe);
      if (!verbes) continue;
      const relache = verbes.some((v) =>
        new RegExp(`this\\.${champ}\\??\\.${v}\\(`).test(corpsLiberation ?? ""),
      );
      if (!relache) oublies.push(`${champ} (${classe}, verbe attendu : ${verbes.join(" ou ")})`);
    }
    expect(oublies).toEqual([]);
  });

  it("appelle la liste unique depuis les DEUX chemins de démontage", () => {
    const finDeVie = /\n  dispose\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(corpsAllocation).toContain("this.libererRessourcesGpu()");
    expect(finDeVie).toContain("this.libererRessourcesGpu()");
  });
});
