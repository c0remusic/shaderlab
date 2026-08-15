import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectRegistry } from "../../src/render/effects/registry";
import { composeShader } from "../../src/render/shaderCompose";
import { getBlendMode } from "../../src/render/blend/registry";

/**
 * VALIDATION STATIQUE DU WGSL, SANS GPU — le seul gate de shader qui puisse
 * tourner en CI.
 *
 * POURQUOI CE FICHIER EXISTE (2026-08-14). `npm run test:gpu-shaders` prouve
 * que les shaders compilent, mais il lui faut une fenêtre WebView2, un GPU et un
 * Vite : `CLAUDE.md` note que les tests GPU/rendu ne tournent PAS en CI. Une
 * faute de syntaxe ou de typage WGSL n'était donc attrapée par RIEN d'automatique
 * — seulement par quelqu'un qui lance la gate à la main sur sa machine.
 *
 * `naga` (crate du projet wgpu, Apache-2.0/MIT) parse et VALIDE du WGSL en
 * CPU pur. C'est exactement le trou à combler.
 *
 * ── CE QUE CE GATE NE REMPLACE PAS ──────────────────────────────────────────
 *
 * Le compilateur du pilote reste le juge final : naga valide la SPEC, pas ce
 * que Dawn puis le JIT NVIDIA accepteront. Un shader vert ici peut encore
 * échouer dans `test:gpu-shaders`. Les deux sont complémentaires, celui-ci
 * étant simplement le seul des deux qui puisse s'exécuter sans écran.
 *
 * ── PORTÉE, DÉCLARÉE PLUTÔT QUE SILENCIEUSE ─────────────────────────────────
 *
 * Couvre la catégorie A de `scripts/gpu-shader-check.mjs` : les shaders COMPOSÉS
 * à partir des fragments du registre d'effets — passe finale de chaque effet,
 * plus chacune de ses passes internes, plus les variantes photo et écrêtage.
 *
 * NE couvre PAS les catégories B et C de ce script (sources complètes de masque,
 * sources paramétriques) : elles ont leurs propres wrappers, et les inclure
 * demanderait de dupliquer ici une énumération qui vit déjà là-bas. C'est une
 * borne assumée, pas un oubli — un gate qui tait ce qu'il ne regarde pas se lit
 * comme une couverture totale.
 */

/** Emplacement du binaire. Installé par `cargo install naga-cli`. */
const NAGA = "naga";

/**
 * ÉCART CONNU, ISOLÉ VOLONTAIREMENT — et il mérite un arbitrage, pas un
 * `expect` tordu jusqu'à ce qu'il passe.
 *
 * Trouvé à la PREMIÈRE exécution de ce gate (2026-08-14). naga refuse notre
 * uniform de paramètres :
 *
 *   @group(0) @binding(2) var<uniform> params: array<f32, 48>;
 *   -> The array stride 4 is not a multiple of the required alignment 16
 *
 * Et il a raison sur la spec : en espace `uniform`, l'alignement requis d'un
 * `array<E,N>` vaut `roundUp(16, align(E))`, donc 16 pour un f32, alors que le
 * pas naturel du tableau est 4. La forme conforme serait `array<vec4<f32>, 12>`.
 *
 * MAIS Dawn l'accepte : les 160 shaders composés compilent dans WebView2, et
 * l'app rend. Ce n'est donc pas un défaut qui se voit à l'usage sur CETTE
 * machine — c'est un risque de PORTABILITÉ, sur une implémentation plus stricte.
 *
 * Le corriger n'est pas anodin : `MAX_EFFECT_PARAMS` est lu en `params[N]` par
 * les vingt-trois effets, et ces index sont GELÉS par les presets et par les
 * références de pixels. Passer en `vec4` change chaque accès. C'est un chantier
 * avec un ADR, pas une correction de test.
 *
 * D'ici là, cette exception laisse le gate faire son travail sur tout le reste.
 * Elle est BORNÉE : elle ne tolère cette erreur que sur la variable `params`.
 * La même erreur sur une autre variable rougira.
 */
const ECART_CONNU_PARAMS =
  /Global variable \[\d+\] 'params' is invalid[\s\S]*?stride 4 is not a multiple of the required alignment 16/;

/** Vrai si la sortie de naga ne contient QUE l'écart connu ci-dessus. */
function seulementEcartConnu(sortie: string): boolean {
  if (!ECART_CONNU_PARAMS.test(sortie)) return false;
  // Une seconde erreur, quelle qu'elle soit, annule la tolérance.
  const erreurs = sortie.match(/^error:/gm) ?? [];
  return erreurs.length === 1;
}

function nagaDisponible(): boolean {
  try {
    execFileSync(NAGA, ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

interface Variante {
  nom: string;
  source: string;
}

/** Toutes les variantes composées du registre, dans le même esprit que
 *  `effectPassRunner.runEffectPass` — mêmes options que le renderer, sinon on
 *  valide un shader qui n'existe pas. */
function variantes(): Variante[] {
  const sortie: Variante[] = [];
  const blendWgsl = getBlendMode("normal").wgsl;

  for (const effet of effectRegistry) {
    const passesInternes = effet.passes ?? [];
    const hasLibraryTexture = effet.libraryTexture !== undefined;

    // Passe FINALE. `hasPrevPass` suit le nombre de passes internes, exactement
    // comme le runner : le déclarer à faux sur un effet qui en a produirait un
    // shader que le renderer n'assemble jamais.
    const base = {
      applyMask: true,
      hasPrevPass: passesInternes.length > 0,
      hasLibraryTexture,
      blendWgsl,
    };
    sortie.push({ nom: `${effet.id} composite`, source: composeShader(effet.wgsl, base) });
    sortie.push({
      nom: `${effet.id} composite+photo`,
      source: composeShader(effet.wgsl, { ...base, hasImageSource: true }),
    });
    sortie.push({
      nom: `${effet.id} composite+clip`,
      source: composeShader(effet.wgsl, { ...base, clipToCoverage: true }),
    });

    // Passes INTERNES : pas de compositing, donc pas de masque ni de fusion.
    passesInternes.forEach((passe, index) => {
      sortie.push({
        nom: `${effet.id} passe#${index}`,
        source: composeShader(passe.wgsl, {
          applyMask: false,
          hasPrevPass: index > 0,
          hasLibraryTexture,
        }),
      });
    });
  }
  return sortie;
}

describe("WGSL composé — validation statique par naga", () => {
  it("naga est installé", () => {
    expect(
      nagaDisponible(),
      "Binaire `naga` introuvable. Installer avec : cargo install naga-cli --locked",
    ).toBe(true);
  });

  // Une invocation de `naga` par variante, soit ~90 sous-processus. Seul, le
  // test tient en 3 s ; dans la suite complète, sous la charge des autres
  // fichiers, il dépassait les 5 s par défaut de Vitest. Le plafond ci-dessous
  // est large exprès : ce test est lent PAR NATURE, et le voir rougir pour une
  // question d'ordonnancement apprendrait à ignorer ses rougeurs.
  it("tous les shaders composés du registre passent la validation", { timeout: 120_000 }, () => {
    if (!nagaDisponible()) return; // le test ci-dessus a déjà rougi
    const dossier = mkdtempSync(join(tmpdir(), "shaderlab-wgsl-"));
    const echecs: string[] = [];
    const liste = variantes();
    try {
      for (const { nom, source } of liste) {
        const fichier = join(dossier, `${nom.replace(/[^\w+#-]/g, "_")}.wgsl`);
        writeFileSync(fichier, source, "utf8");
        try {
          execFileSync(NAGA, [fichier], { stdio: "pipe" });
        } catch (e) {
          const err = e as { stderr?: Buffer; stdout?: Buffer };
          const detail = (err.stderr?.toString() || err.stdout?.toString() || String(e)).trim();
          if (seulementEcartConnu(detail)) continue;
          echecs.push(`${nom}\n${detail}`);
        }
      }
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
    expect(liste.length).toBeGreaterThan(0);
    expect(echecs.join("\n\n---\n\n")).toBe("");
  });
});
