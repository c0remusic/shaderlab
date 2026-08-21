import { describe, it, expect } from "vitest";
import { sliceShift } from "../../../src/render/effects/sliceShift";
import { getEffect } from "../../../src/render/effects/registry";

/**
 * SLICE SHIFT — et ce fichier naît d'un manque relevé en revue le 2026-08-02 :
 * l'effet n'avait AUCUN test unitaire, alors qu'il venait de recevoir un
 * paramètre. Les deux verrous de pixels couvrent son rendu ; ils ne couvrent
 * pas ce que ses commentaires AFFIRMENT.
 *
 * C'est la distinction qui compte ici. Le défaut récurrent du dépôt, consigné
 * cinq fois dans `.claude/learning-log.md`, est un commentaire qui affirme une
 * propriété que le code n'a pas — et deux affirmations de cet effet étaient
 * fausses depuis son écriture, jusqu'à cette revue. Un test de rendu ne les
 * aurait jamais vues : elles portent sur la LOI du mécanisme, pas sur une
 * image. D'où des tests qui vérifient la loi elle-même.
 */

const wgsl = sliceShift.wgsl;

describe("sliceShift — le paramètre de fondu est réellement câblé", () => {
  it("déclare huit paramètres, le fondu en dernier et à zéro", () => {
    // EN DERNIER, et c'est une contrainte de format et pas un rangement :
    // l'index d'un paramètre est PERSISTÉ dans les presets. Insérer au milieu
    // décalerait silencieusement les réglages de tous les documents existants.
    const noms = sliceShift.params.map((p) => p.name);
    expect(noms).toEqual([
      "angle", "sliceSize", "displace", "density", "irregular", "chromaSplit", "seed", "edgeFeather",
    ]);
    expect(sliceShift.params[7].default).toBe(0);
    expect(sliceShift.params[7].unit).toBe("pixels");
  });

  it("lit le fondu à SON index, et l'annule au-delà de l'épaisseur d'une tranche", () => {
    // Le clamp n'est pas cosmétique : la bande de fondu est large de f/2 de
    // chaque côté d'une frontière, donc au-delà de `sliceSize` les deux
    // frontières d'une même tranche se recouvriraient et il faudrait mélanger
    // trois tranches à la fois.
    expect(wgsl).toContain("let edgeFeather = clamp(params[7], 0.0, sliceSize);");
  });

  it("sort avant le fondu à zéro — la neutralité du défaut est STRUCTURELLE", () => {
    // Une sortie anticipée et non un `mix` à poids nul : à `edgeFeather` = 0 il
    // reste exactement le code d'avant ce paramètre, trois taps compris, donc
    // la référence de pixels écrite avant lui vaut preuve de non-régression.
    // La branche est UNIFORME (les paramètres viennent d'un buffer uniforme),
    // ce qui autorise `textureSample` de part et d'autre.
    expect(wgsl).toContain("if (edgeFeather <= 0.0) {");
  });

  it("FONDU ENCHAÎNÉ : deux lectures franches, jamais une coordonnée inventée", () => {
    // ⚠️ Test RETOURNÉ le 2026-08-02 après le verdict visuel d'Antoine. Il
    // exigeait d'abord un mélange des COORDONNÉES ; celui-ci cisaillait le
    // contenu de la bande (« ça ressemble plus à du warping ») au lieu
    // d'adoucir la limite. Ce qui est demandé — « moins net, sans être flou,
    // juste que la limite soit moins franche » — n'a qu'une lecture : garder
    // les deux tranches NETTES et rendre leur passage progressif.
    //
    // Concrètement : `trancheEchantillonnee` est appelée deux fois, chacune
    // avec le décalage ENTIER de sa tranche, et c'est le résultat qui est mêlé.
    // Aucun `mix` ne porte sur un décalage.
    expect(wgsl).toContain("return vec4<f32>(mix(couleurVoisine, couleur, w), color.a);");
    expect(wgsl.match(/trancheEchantillonnee\(/g)?.length).toBe(3); // 1 déclaration + 2 appels
    expect(wgsl).not.toContain("amount = mix(");

    // Les trois taps vivent dans la fonction extraite, donc une seule fois dans
    // le source — mais elle est appelée deux fois quand le fondu est actif.
    expect(wgsl.match(/textureSample\(/g)?.length).toBe(3);
  });
});

describe("sliceShift — le profil de fondu, et pourquoi ce n'est pas une rampe", () => {
  /* Ce bloc a survécu SANS MODIFICATION au changement d'implémentation du
   * 2026-08-02 (mélange de décalages → fondu enchaîné), et c'est une propriété
   * qu'on voulait : il décrit le PROFIL du poids, qui est le même quel que soit
   * ce sur quoi ce poids s'applique. Un test qui doit être réécrit à chaque
   * changement de mécanisme testait le mécanisme, pas l'intention. */

  /** Le poids de la tranche courante, transcrit du shader. `d` est la distance
   *  en pixels à la frontière la plus proche, `f` la largeur du fondu. */
  const w = (d: number, f: number) => {
    const t = Math.min(1, Math.max(0.5, 0.5 + d / f));
    return t * t * (3 - 2 * t); // smoothstep(0, 1, t)
  };

  it("partage exactement la frontière en deux", () => {
    // Sur la frontière (d = 0), les deux tranches pèsent pareil. C'est ce qui
    // rend le décalage CONTINU quand on la traverse : les deux côtés calculent
    // la même moyenne, chacun depuis son propre point de vue.
    expect(w(0, 16)).toBeCloseTo(0.5, 12);
  });

  it("a une pente NULLE aux deux bords du fondu — c'est tout l'intérêt", () => {
    // Une rampe linéaire aurait une pente constante jusqu'au bord, donc une
    // dérivée qui casse en y arrivant : deux plis fins de part et d'autre, une
    // coupure remplacée par deux marques. Ici la pente s'annule en douceur.
    const f = 16, eps = 1e-4;
    const penteAuBord = (w(f / 2, f) - w(f / 2 - eps, f)) / eps;
    expect(Math.abs(penteAuBord)).toBeLessThan(1e-3);

    // Et elle est MAXIMALE sur la frontière : le décrochage reste un
    // décrochage, il n'est pas étalé uniformément.
    const penteAuCentre = (w(eps, f) - w(0, f)) / eps;
    expect(penteAuCentre).toBeGreaterThan(1.4 / f);
  });

  it("est C¹ à la traversée de la frontière, et pas seulement continu", () => {
    // Le point non évident. `d = min(local, sliceSize - local)` a un coude en
    // valeur absolue sur la frontière, MAIS l'ordre des arguments de `mix`
    // s'inverse au même endroit (le voisin passe de `band+1` à `band-1`). Les
    // deux inversions se compensent : la pente est la même des deux côtés. Sans
    // cette compensation, une marque apparaîtrait au MILIEU du fondu — là
    // précisément où on veut qu'il n'y ait rien à voir.
    //
    // Vrai des deux mécanismes : la quantité mêlée était un décalage, elle est
    // maintenant une couleur, et l'argument ne porte que sur le poids.
    const f = 16, A = 0.1, B = -0.05; // les deux quantités mêlées
    // `s` signé : négatif du côté de la tranche B, positif du côté de A.
    const melange = (s: number) =>
      s >= 0 ? B + (A - B) * w(s, f) : A + (B - A) * w(-s, f);
    const eps = 1e-5;
    const penteDroite = (melange(eps) - melange(0)) / eps;
    const penteGauche = (melange(0) - melange(-eps)) / eps;
    expect(penteDroite).toBeCloseTo(penteGauche, 6);
  });

  it("laisse le cœur de la tranche à son décalage PLEIN tant que f < sliceSize", () => {
    // Sinon le fondu ne serait plus un fondu de BORD : il mangerait la tranche
    // entière, et le décrochage — la signature de l'effet — disparaîtrait.
    const sliceSize = 32;
    for (const f of [4, 8, 16, 31]) {
      expect(w(sliceSize / 2, f)).toBe(1);
    }
    // À la borne haute du clamp, les deux bandes se touchent pile au milieu :
    // il ne reste qu'une ligne de décalage plein. C'est la limite du domaine,
    // atteinte et pas dépassée.
    expect(w(sliceSize / 2, sliceSize)).toBe(1);
  });
});

describe("sliceShift — la loi d'adoption, et les deux choses qu'elle NE fait pas", () => {
  /* Ces deux tests corrigent des affirmations qui ont vécu dans le fichier
   * depuis son écriture. Ils ne dépendent pas du hachage précis : la loi est
   * `id(B) = B-1 si u(B) < irrégularité, sinon B`, pour n'importe quel tirage
   * uniforme indépendant. Ce sont ses CONSÉQUENCES qui sont testées. */

  const identites = (n: number, irregular: number, u: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => (u(i) < irregular ? i - 1 : i));

  /** Générateur déterministe, uniforme et indépendant par bande. */
  const tirage = (graine: number) => (i: number) => {
    const x = Math.sin(i * 12.9898 + graine * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  it("l'adoption n'est PAS transitive : les épaisseurs sont 1x et 2x, jamais 3x", () => {
    // `id(B) ∈ {B-1, B}`. Deux bandes ne partagent une identité que si B adopte
    // ET que B-1 n'adopte pas — car si B-1 adopte aussi, elle descend en B-2 et
    // les deux se manquent. Trois bandes consécutives ne peuvent donc jamais
    // partager. Le commentaire d'origine promettait « 1x, 2x, 3x ».
    for (const irregular of [0.2, 0.35, 0.5, 0.8]) {
      const id = identites(5000, irregular, tirage(irregular * 100));
      const epaisseurs = new Set<number>();
      let courant = 1;
      for (let i = 1; i < id.length; i++) {
        if (id[i] === id[i - 1]) courant++;
        else { epaisseurs.add(courant); courant = 1; }
      }
      expect([...epaisseurs].sort()).toEqual([1, 2]);
    }
  });

  /** Part des frontières qui fusionnent, pour une probabilité d'ADOPTION donnée
   *  (et non pour une position de curseur — les deux ont cessé d'être la même
   *  chose le 2026-08-03, voir le test suivant). */
  const partFusionnee = (adoption: number) => {
    const id = identites(20000, adoption, tirage(7));
    let f = 0;
    for (let i = 1; i < id.length; i++) if (id[i] === id[i - 1]) f++;
    return f / (id.length - 1);
  };

  it("la LOI reste non monotone : elle culmine à 0,5 d'adoption et retombe à zéro à 1", () => {
    // `P(fusion) = adoption × (1 - adoption)`. Conséquence directe et
    // contre-intuitive : une adoption de 1 redonne exactement le peigne qu'elle
    // devait détruire, puisque TOUTES les bandes adoptent et qu'aucune ne
    // partage plus.
    expect(partFusionnee(0)).toBe(0);
    expect(partFusionnee(1)).toBe(0);
    expect(partFusionnee(0.5)).toBeGreaterThan(0.2);
    expect(partFusionnee(0.5)).toBeGreaterThan(partFusionnee(0.9));
    expect(partFusionnee(0.9)).toBeGreaterThan(partFusionnee(0.99));

    // ⚠️ Ce test décrit le MÉCANISME, qui n'a pas changé. Ce qui a changé le
    // 2026-08-03, c'est la portion du mécanisme que le curseur peut atteindre.
  });

  it("mais le CURSEUR est désormais monotone sur toute sa course", () => {
    // LE CORRECTIF (arbitrage d'Antoine, D11). Le curseur est remappé sur
    // `[0 ; 0,5]`, c'est-à-dire exactement le flanc croissant de la loi
    // ci-dessus. Pousser à fond ne peut donc plus dégrader l'effet, et le
    // maximum du curseur EST le maximum du mécanisme.
    const curseur = (position: number) => partFusionnee(position * 0.5);

    let precedent = -1;
    for (let i = 0; i <= 20; i++) {
      const p = curseur(i / 20);
      // Croissance stricte au bruit d'échantillonnage près : 20 000 bandes,
      // donc une tolérance d'un demi-pour-cent suffit à écarter le hasard.
      expect(p).toBeGreaterThan(precedent - 0.005);
      precedent = p;
    }
    // Et le bout de la course vaut bien le sommet de la loi, pas zéro.
    expect(curseur(1)).toBeGreaterThan(0.2);
    expect(curseur(1)).toBeGreaterThan(curseur(0.5));
  });

  it("le shader implémente bien CETTE loi, d'un seul niveau, et remappe le curseur", () => {
    // Le pont entre la loi testée ci-dessus et le code réel : une seule
    // soustraction d'un, sous un seul tirage comparé à `irregular`.
    expect(wgsl).toContain("if (hash(vec2<f32>(band, seed + 101.0)) < irregular) {");
    expect(wgsl).toContain("id = band - 1.0;");
    expect(wgsl.match(/id = band - 1\.0;/g)?.length).toBe(1);
    // Le remappage, à l'endroit unique où le paramètre est lu.
    expect(wgsl).toContain("let irregular = clamp(params[4], 0.0, 1.0) * 0.5;");
  });
});

describe("sliceShift — le fondu n'a plus de course morte", () => {
  it("borne le CURSEUR au TIERS de l'épaisseur, pas à l'épaisseur entière", () => {
    // DÉFAUT RÉEL relevé le 2026-08-02, corrigé en DEUX temps :
    //  - 2026-08-03 : maximum déclaré 200 px alors que l'effectif était
    //    `sliceSize` — les trois quarts du curseur morts. Borné à `sliceSize`.
    //  - 2026-08-21 : `sliceSize` bornait encore trop HAUT. Le fondu mélange les
    //    deux tranches sur `f/2` de chaque côté, donc à `f = sliceSize` la bande
    //    couvre TOUTE la tranche et le contenu se lit comme un flou (retour
    //    d'Antoine). Borné au TIERS : au max, le cœur reste net.
    const feather = sliceShift.params.find((p) => p.name === "edgeFeather")!;
    const defauts: Record<string, number> = {};
    for (const p of sliceShift.params) defauts[p.name] = p.default;

    expect(feather.maxFrom).toBeDefined();
    // À l'épaisseur par défaut (48), la course s'arrête au tiers (16).
    expect(feather.maxFrom!(defauts)).toBe(16);
    // Et elle SUIT l'épaisseur, c'est tout l'intérêt d'un maximum dynamique.
    expect(feather.maxFrom!({ ...defauts, sliceSize: 120 })).toBe(40);
    // Plancher à 2 : une tranche très fine garde une course minimale utilisable.
    expect(feather.maxFrom!({ ...defauts, sliceSize: 4 })).toBe(2);
    // Jamais au-dessus de la borne déclarée, que `validateEffect` impose.
    expect(feather.maxFrom!({ ...defauts, sliceSize: 400 })).toBeLessThanOrEqual(feather.max);
  });

  it("garde son clamp DANS le shader — un preset ne passe pas par le panneau", () => {
    // `maxFrom` borne un curseur ; il ne borne pas une valeur. `updateParams`
    // n'écrête rien, et un preset écrit à la main n'a jamais vu l'interface.
    // Les deux gardes sont nécessaires et ne font pas le même travail.
    expect(wgsl).toContain("let edgeFeather = clamp(params[7], 0.0, sliceSize);");
  });
});

describe("sliceShift — la fonction extraite est partagée, pas dupliquée", () => {
  it("déclare sliceAmount UNE fois et l'appelle pour les deux tranches", () => {
    // Dupliquer la règle d'adoption ferait diverger la tranche courante de sa
    // voisine, et le fondu serait faux EXACTEMENT aux frontières fusionnées —
    // là où il doit être invisible, donc là où personne ne le verrait.
    expect(wgsl.match(/fn sliceAmount\(/g)?.length).toBe(1);
    expect(wgsl.match(/sliceAmount\(/g)?.length).toBe(3); // 1 déclaration + 2 appels
  });

  it("reste enregistré au registre sous son identifiant", () => {
    expect(getEffect("sliceShift")).toBe(sliceShift);
  });
});
