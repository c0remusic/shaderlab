import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Slice shift — tranche l'image en bandes et décale chacune, du léger décrochage
 * au glitch franc.
 *
 * LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » : bandes
 * d'épaisseur constante, décalage aléatoire par bande, coordonnée qui repart de
 * l'autre bord. Quatre pannes, toutes visibles à l'œil, toutes corrigées ici :
 *
 * 1. **Des bandes toutes de la même épaisseur font un PEIGNE.** L'œil trouve la
 *    période en une seconde et l'image se lit comme un store vénitien, pas comme
 *    un accident. « Irrégularité » fait fusionner une bande avec sa voisine : la
 *    fusion se fait par ADOPTION de l'identité du voisin (une bande prend
 *    l'index de celle d'avant), jamais en déformant l'axe avant de le
 *    quantifier — un axe déformé n'est plus monotone et les bandes se
 *    chevaucheraient, ce qui produit des doublons de contenu.
 *
 *    ⚠️ **Deux propriétés de ce mécanisme sont contre-intuitives, et le
 *    commentaire d'origine affirmait le contraire des deux.** Mesurées le
 *    2026-08-02, à la relecture adverse du fondu.
 *
 *    L'adoption est d'un seul niveau et NON TRANSITIVE : `id(B) ∈ {B-1, B}`.
 *    Deux bandes ne partagent une identité que si `B` adopte et que `B-1`
 *    n'adopte PAS — car si `B-1` adopte aussi, elle descend en `B-2` et les
 *    deux se manquent. Les épaisseurs sont donc **1x et 2x uniquement, jamais
 *    3x**. Sur la graine 0 du scénario verrouillé, les bandes 1, 2 et 3 adoptent
 *    toutes les trois et une SEULE frontière fusionne.
 *
 *    Corollaire, et c'était un vrai défaut de contrôle : `P(fusion) = x·(1 − x)`
 *    où `x` est la probabilité d'adoption, donc une courbe qui **culmine à 0,5
 *    et retombe à ZÉRO à 1,0**. Pousser le curseur à fond redonnait exactement
 *    le peigne qu'il devait détruire — toutes les bandes adoptent, donc aucune
 *    ne partage.
 *
 *    **CORRIGÉ le 2026-08-03** (arbitrage d'Antoine, D11) : le curseur est
 *    remappé sur `[0 ; 0,5]`, donc sa course entière est du côté croissant et
 *    son maximum est le maximum du mécanisme — une frontière sur quatre. Une
 *    ligne, aucun changement de mécanisme, et les références de rendu rejouées
 *    puisque le défaut 0,45 rend désormais 0,225 d'adoption.
 *
 *    Ce que ça ne corrige PAS : les épaisseurs 1x/2x ci-dessus. Elles tiennent à
 *    la non-transitivité de l'adoption, pas au curseur.
 *
 * 2. **Le rebouclage par l'autre bord recolle deux bords étrangers.** Une bande
 *    décalée montrerait le bord droit de l'image collé à son bord gauche : une
 *    couture verticale franche, à chaque bande, toujours au même endroit —
 *    exactement le motif régulier qu'on essayait d'éviter. `mirrorUv` replie par
 *    réflexion : la bande sort sur du contenu continu.
 *
 * 3. **Décaler TOUTES les bandes détruit l'image.** Il ne reste rien à
 *    reconnaître, donc rien à casser — un glitch n'est lisible que contre ce qui
 *    tient encore. « Densité » fixe la part de bandes réellement décalées ; le
 *    reste de l'image est intact au pixel près.
 *
 * 4. **Un décalage identique sur les trois canaux ne ressemble à aucun défaut
 *    réel.** La signature d'une image corrompue, c'est la désynchronisation des
 *    canaux. « Écart des canaux » décale le rouge et le bleu un peu plus et un
 *    peu moins que le vert, proportionnellement au décalage de la bande — donc
 *    nul là où la bande ne bouge pas, jamais un liseré coloré posé sur une zone
 *    immobile.
 *
 * 5. **La frontière entre deux tranches est une COUPURE FRANCHE**, et c'est la
 *    signature de l'effet — un décrochage. « Fondu des bords » (défaut 0, donc
 *    rien ne change sans le demander) rend cette limite progressive par un
 *    FONDU ENCHAÎNÉ entre les deux tranches.
 *
 *    **Deux fausses pistes ont été essayées avant, dans cet ordre, et elles
 *    valent d'être gardées écrites : l'une comme l'autre paraissent la bonne
 *    réponse tant qu'on ne l'a pas vue à l'écran.**
 *
 *    *Faire varier le DÉCALAGE continûment* de part et d'autre de la frontière.
 *    Séduisant — un seul tap de plus, aucune valeur inventée, et la ligne
 *    disparaît bien. Livré le 2026-08-02, rejeté sur pièce par Antoine le jour
 *    même : « ça ressemble plus à du warping ». Et il a raison ; la revue
 *    adverse l'avait chiffré sans pouvoir en juger, un décalage qui varie
 *    CISAILLE le contenu de la bande, jusqu'à ~71° de pente aux réglages
 *    testés. On ne supprime pas la limite, on la remplace par une déformation.
 *
 *    *Flouter le bord.* Écarté dans la même passe : « pour que les bords
 *    deviennent moins nets, sans être flous ». La demande porte sur la LIMITE,
 *    pas sur le contenu.
 *
 *    **Ce qui est fait ici**, seule lecture compatible avec les deux refus :
 *    chaque tranche est échantillonnée à SON propre décalage — donc reste
 *    parfaitement nette — et c'est le passage de l'une à l'autre qui devient
 *    progressif. Aucune coordonnée intermédiaire n'est fabriquée : le fondu
 *    CHOISIT entre deux lectures franches au lieu d'en inventer une troisième.
 *
 *    Prix assumé, à connaître avant de pousser le curseur : dans la bande, on
 *    voit les DEUX tranches à la fois. Étroite, ça se lit comme un bord adouci ;
 *    large, comme une surimpression.
 *
 *    Le fondu se mesure en PIXELS et non en fraction de tranche : sinon une
 *    tranche fine serait entièrement fondue quand une épaisse ne le serait
 *    qu'au bord.
 *
 * COÛT : 3 taps (un par canal), une seule passe, aucune texture intermédiaire.
 * Le fondu porte ça à 6 taps, et seulement quand il est actif — la branche est
 * UNIFORME, les paramètres venant d'un buffer uniforme. Il double aussi les
 * tirages de hachage (`sliceAmount` en fait trois, appelée deux fois : 3 → 6).
 *
 * `seed` rend le tirage REPRODUCTIBLE : deux ouvertures du même document
 * donnent les mêmes tranches. C'est le même choix que `grain`, et ce qui permet
 * à `npm run test:render` de verrouiller cet effet au pixel.
 */
export const sliceShift: EffectModule = {
  id: "sliceShift",
  name: "Slice shift",
  params: [
    { name: "angle", label: "Direction des tranches", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "0° = bandes horizontales décalées horizontalement" },
    { name: "sliceSize", label: "Épaisseur des tranches", unit: "pixels", min: 2, max: 400, default: 48, step: 1, hint: "Épaisseur de base, en pixels pleine résolution — l'irrégularité en fusionne certaines" },
    { name: "displace", label: "Décalage", unit: "percent", min: 0, max: 0.5, default: 0.08, step: 0.005, hint: "Amplitude maximale du glissement d'une tranche, en fraction de l'image" },
    { name: "density", label: "Densité", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Part des tranches réellement décalées — le reste de l'image reste intact, et c'est ce qui rend le décrochage lisible" },
    { name: "irregular", label: "Irrégularité", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Fait fusionner des tranches avec leur voisine — sans elle, les bandes forment un peigne à période visible. À fond, une frontière sur quatre fusionne : c'est le maximum que le mécanisme permet, et le curseur y monte désormais sans jamais redescendre" },
    { name: "chromaSplit", label: "Écart des canaux", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "Désynchronise rouge et bleu par rapport au vert, proportionnellement au décalage de la tranche" },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 1000, default: 0, step: 1, hint: "Change le tirage sans changer les réglages. Reproductible : la même graine redonne les mêmes tranches" },
    // `maxFrom` : la course s'arrête à l'épaisseur d'une tranche, parce que
    // c'est là que le shader borne (voir le clamp dans `fs_main`, et le calcul
    // de recouvrement qui l'explique). Sans ce champ, le curseur déclarait 200
    // px et n'en servait que 48 par défaut — trois quarts de course morts,
    // silencieux, relevés le 2026-08-02 et corrigés le 2026-08-03 le jour où le
    // système de paramètres a su l'exprimer.
    { name: "edgeFeather", label: "Fondu des bords", unit: "pixels", min: 0, max: 400, default: 0, step: 1, maxFrom: (p) => Math.max(2, Math.min(400, p.sliceSize)), hint: "Adoucit la frontière entre deux tranches, en pixels pleine résolution. À 0 la coupure est franche — c'est la signature de l'effet. Sa course suit l'épaisseur des tranches : au-delà, deux fondus se recouvriraient au milieu d'une tranche" },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HASH_WGSL}
// Décalage d'une tranche, fonction PURE de son index — extraite pour que le
// fondu puisse demander celui de la tranche VOISINE sans dupliquer la règle
// d'adoption. Toute divergence entre les deux appels rendrait le fondu faux
// aux frontières fusionnées, précisément là où il doit être invisible.
fn sliceAmount(band: f32, seed: f32, irregular: f32, density: f32, displace: f32) -> f32 {
  // ADOPTION : une bande sur \`irregular\` prend l'identité de sa voisine
  // précédente, donc son décalage. Deux bandes adjacentes qui partagent une
  // identité forment une bande deux fois plus épaisse, trois en forment une
  // triple. Monotone par construction : aucun chevauchement possible, donc
  // aucun contenu dupliqué.
  var id = band;
  if (hash(vec2<f32>(band, seed + 101.0)) < irregular) {
    id = band - 1.0;
  }

  // Deux tirages INDÉPENDANTS sur la même identité : l'un décide si la tranche
  // bouge, l'autre de combien. Un seul tirage ferait que les tranches actives
  // seraient exactement celles au grand décalage — la densité deviendrait un
  // second réglage d'amplitude au lieu d'un réglage de proportion.
  // \`moved\` et non \`active\` : \`active\` est un mot RÉSERVÉ de WGSL et le
  // compilateur le refuse comme nom de variable. Attrapé par
  // \`npm run test:gpu-shaders\`, jamais par tsc.
  let moved = step(1.0 - density, hash(vec2<f32>(id, seed + 17.0)));
  return (hash(vec2<f32>(id, seed)) * 2.0 - 1.0) * displace * moved;
}

// Le contenu d'UNE tranche, lu à SON décalage — trois taps, un par canal.
//
// Extraite pour que le fondu enchaîné puisse demander la tranche voisine par le
// même chemin exactement. C'est ce qui garantit que la tranche voisine est
// échantillonnée aussi NETTEMENT que la courante : le fondu ne fabrique aucune
// coordonnée intermédiaire, il choisit entre deux lectures franches.
fn trancheEchantillonnee(
  q: vec2<f32>, ar: vec2<f32>, along: vec2<f32>, amount: f32, chromaSplit: f32,
) -> vec3<f32> {
  // Écart des canaux PROPORTIONNEL au décalage : nul sur une tranche immobile,
  // donc jamais de frange colorée sur une zone que l'utilisateur voit comme
  // intacte.
  let split = amount * chromaSplit * 0.18;
  let baseUv = (q + along * amount) / ar + vec2<f32>(0.5);
  let deltaUv = (along * split) / ar;

  return vec3<f32>(
    textureSample(srcTexture, srcSampler, mirrorUv(baseUv + deltaUv)).r,
    textureSample(srcTexture, srcSampler, mirrorUv(baseUv)).g,
    textureSample(srcTexture, srcSampler, mirrorUv(baseUv - deltaUv)).b,
  );
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let angle = radians(params[0]);
  let sliceSize = max(params[1], 1.0);
  let displace = params[2];
  let density = clamp(params[3], 0.0, 1.0);
  // CURSEUR REMAPPÉ SUR [0 ; 0,5], et c'est le correctif du 2026-08-03.
  //
  // La probabilité qu'une frontière fusionne vaut \`x·(1−x)\` où \`x\` est la
  // probabilité d'adoption (voir \`sliceAmount\` : B et B−1 ne partagent une
  // identité que si B adopte et que B−1 n'adopte PAS). Cette courbe culmine à
  // x = 0,5 et **retombe à zéro en x = 1** — le curseur poussé à fond redonnait
  // exactement le peigne qu'il devait détruire, parce que toutes les bandes
  // adoptaient et qu'aucune ne partageait plus rien.
  //
  // En bornant \`x\` à 0,5, la course entière est du côté CROISSANT : le curseur
  // va de 0 fusion à une frontière sur quatre, et rien au-dessus ne dégrade. Un
  // remappage d'une ligne, pas une refonte du mécanisme — l'adoption d'un seul
  // niveau reste monotone par construction, donc aucun chevauchement de bandes.
  //
  // ⚠️ CE QUE ÇA NE CORRIGE PAS, et qui reste écrit en tête de fichier : les
  // épaisseurs valent 1x ou 2x, jamais 3x. C'est une propriété de l'adoption
  // non transitive, pas du curseur. La corriger demanderait des identités par
  // LONGUEUR DE SÉRIE, donc une remontée itérative bornée dont le plafond
  // recréerait un peigne local aux fortes valeurs — un autre effet, pas un
  // autre réglage.
  let irregular = clamp(params[4], 0.0, 1.0) * 0.5;
  let chromaSplit = clamp(params[5], 0.0, 1.0);
  let seed = params[6];
  // BORNÉ À L'ÉPAISSEUR D'UNE TRANCHE, et ce n'est pas un garde-fou cosmétique.
  // La bande de fondu est centrée sur la frontière, donc large de \`f/2\` de
  // chaque côté. Pour que les DEUX frontières d'une même tranche ne se
  // recouvrent pas au milieu, il faut \`f/2 <= sliceSize - f/2\`, soit
  // \`f <= sliceSize\`. Au-delà il faudrait mélanger trois tranches à la fois ;
  // le clamp interdit ce cas au lieu de le rendre faux en silence.
  //
  // COURSE MORTE, CORRIGÉE le 2026-08-03. Le maximum déclaré était 200 px et
  // l'effectif \`sliceSize\` (48 par défaut) : les trois quarts du curseur ne
  // faisaient rien, sans aucun retour dans le panneau. Le correctif annoncé ici
  // était « un maximum DYNAMIQUE lié à \`sliceSize\`, que le système de
  // paramètres ne sait pas exprimer » — il sait, depuis \`EffectParam.maxFrom\`,
  // posé ce jour-là précisément pour ce cas.
  //
  // Ce clamp RESTE, et ce n'est pas une redondance : \`maxFrom\` borne le
  // CURSEUR, pas la valeur. Un preset écrit à la main ou un \`updateParams\`
  // programmatique n'ont jamais vu le panneau, et \`LayerStack.updateParams\` ne
  // borne rien.
  let edgeFeather = clamp(params[7], 0.0, sliceSize);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let q = (uv - vec2<f32>(0.5)) * ar;
  // \`along\` est la direction DANS laquelle une tranche glisse ; \`normal\` est
  // l'axe le long duquel on les compte. Les deux sortent du même angle, donc
  // tourner l'effet fait tourner bandes ET glissement ensemble — les découpler
  // donnerait un cisaillement, pas des tranches.
  let along = vec2<f32>(cos(angle), sin(angle));
  let normal = vec2<f32>(-along.y, along.x);

  // Index de tranche. \`q\` est en pixels/sqrt(W*H) : on remultiplie pour que
  // « épaisseur » soit lisible en PIXELS pleine résolution, comme le rayon du
  // pinceau et l'épaisseur de trait d'\`outlines\`.
  let n = dot(q, normal) * sqrt(dims.x * dims.y);
  let band = floor(n / sliceSize);
  // Position DANS la tranche, en pixels : 0 au bord bas, \`sliceSize\` au bord
  // haut. C'est la seule mesure dont le fondu a besoin, et elle est déjà en
  // pixels — d'où le choix de l'unité du paramètre.
  let local = n - band * sliceSize;

  let amount = sliceAmount(band, seed, irregular, density, displace);
  let couleur = trancheEchantillonnee(q, ar, along, amount, chromaSplit);

  // SANS FONDU, on s'arrête ici : trois taps, exactement le code d'avant que ce
  // paramètre existe. La branche est UNIFORME (les paramètres viennent d'un
  // buffer uniforme), donc ce n'est pas seulement un raccourci de performance —
  // c'est ce qui rend la neutralité du défaut structurelle, et pas seulement
  // numérique.
  if (edgeFeather <= 0.0) {
    return vec4<f32>(couleur, color.a);
  }

  // LE FONDU : un FONDU ENCHAÎNÉ entre les deux tranches, et surtout PAS un
  // mélange de leurs décalages.
  //
  // La première version faisait varier le décalage continûment de part et
  // d'autre de la frontière. C'était mathématiquement élégant — un seul tap de
  // plus, aucune valeur inventée — mais Antoine l'a rejetée sur pièce le
  // 2026-08-02 : « ça ressemble plus à du warping ». Il avait raison, et la
  // revue l'avait chiffré sans pouvoir le juger : faire varier le décalage
  // CISAILLE le contenu de la bande (pente ~71° aux réglages testés). Ce qui
  // était demandé n'était ni un cisaillement ni un flou — « juste que la limite
  // soit moins franche ».
  //
  // Un fondu enchaîné répond exactement à ça : les deux tranches restent NETTES
  // (chacune est échantillonnée à son propre décalage, aucune coordonnée n'est
  // inventée), et c'est le passage de l'une à l'autre qui devient progressif au
  // lieu d'être une ligne. Le prix, assumé : dans la bande on voit les deux à la
  // fois. Étroite, ça se lit comme un bord adouci ; large, comme une surimpression.
  //
  // Coût : 3 taps deviennent 6, et seulement quand le fondu est actif.
  let d = min(local, sliceSize - local);
  let voisin = select(band + 1.0, band - 1.0, local < sliceSize - local);

  // \`w\` = poids de la tranche courante. Vaut 0.5 pile SUR la frontière — donc
  // les deux côtés calculent la même moyenne et la traversée est continue — et
  // remonte à 1 au bord de la bande de fondu.
  //
  // SMOOTHSTEP ET NON UNE RAMPE LINÉAIRE : une rampe a une dérivée qui casse
  // aux deux bords du fondu, ce qui pose deux plis fins de part et d'autre — on
  // aurait remplacé une coupure par deux marques. Smoothstep est de pente nulle
  // en 1, donc raccordé tangent à la tranche pleine.
  let w = smoothstep(0.0, 1.0, clamp(0.5 + d / edgeFeather, 0.5, 1.0));

  let amountVoisin = sliceAmount(voisin, seed, irregular, density, displace);
  let couleurVoisine = trancheEchantillonnee(q, ar, along, amountVoisin, chromaSplit);

  return vec4<f32>(mix(couleurVoisine, couleur, w), color.a);
}
`,
};
