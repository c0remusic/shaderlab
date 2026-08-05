// Les 39 declarations « Sans objet » du registre, et comment les EPROUVER.
//
// ─────────────────────────────────────────────────────────────────────────
// Pourquoi ce fichier existe
// ─────────────────────────────────────────────────────────────────────────
// Trente-neuf parametres du registre portent « Sans objet en ... » dans leur
// infobulle. Aucun n'a jamais ete mesure : la phrase a ete ecrite par l'auteur
// de l'effet, au jugement. Or cette connaissance a deja ete FAUSSE DANS LES
// DEUX SENS sur ce depot :
//
//  - `sliceShift` avait deux courses MORTES que rien ne declarait (D11) ;
//  - `glass` declarait « Sans objet en Poli » sur un curseur VIVANT, qui a
//    fond de course fabriquait de l'aliasing (trouve le 2026-08-04).
//
// Task 1 du plan `2026-08-04-rationalisation-des-controles.md` : eprouver les
// trente-neuf avant d'en porter une seule vers un contrat de masquage. Masquer
// un controle suppose de SAVOIR qu'il est inerte.
//
// ─────────────────────────────────────────────────────────────────────────
// Le protocole, et le piege qu'il evite
// ─────────────────────────────────────────────────────────────────────────
// Pour chaque declaration : deux rendus identiques a un parametre pres, dans
// la configuration ou il est DECLARE inerte. Zero canal d'ecart = inerte.
//
// Mais « zero ecart » a DEUX causes possibles, et une seule est la bonne :
// le curseur est vraiment inerte, ou l'effet entier ne fait rien dans cette
// configuration. Une sonde qui ne mesurerait que l'ecart min/max rendrait
// « inerte » sur un effet eteint — exactement le defaut que `verifierSignal`
// corrige dans le harnais de rendu (une reference qu'on ne peut plus faire
// rougir ne prouve rien).
//
// Chaque mesure porte donc DEUX chiffres : l'ecart du curseur, et l'ecart de
// la configuration contre la photo de fond seule. Le second sous un seuil rend
// le verdict NON CONCLUANT, jamais « inerte ».
//
// ─────────────────────────────────────────────────────────────────────────
// Choix des deux valeurs
// ─────────────────────────────────────────────────────────────────────────
// Les bornes du parametre, sauf quand une PERIODICITE les rendrait egales par
// construction : `bladeRotation` et `fieldAngle` vont de 0 a 360 degres, et
// 0 vs 360 est le meme angle. Un « aucun ecart » y serait un artefact du choix
// des valeurs, pas une propriete du parametre. Ces cas prennent 0 vs 37 — un
// angle qui n'est la symetrie d'aucun diaphragme a lames entieres.
//
// ─────────────────────────────────────────────────────────────────────────
// Ce qu'une configuration de base doit contenir
// ─────────────────────────────────────────────────────────────────────────
// Assez pour que l'effet AGISSE (sinon la garde de signal ci-dessus tire), et
// rien de plus. Les valeurs sont reprises des scenarios existants de
// `render-check.mjs` quand il y en a un — c'est le jeu de parametres qui a
// deja montre qu'il produisait une image.

/** Chaque entree : une DECLARATION (un parametre et son infobulle), eprouvee
 *  dans une ou plusieurs configurations excluantes. La declaration n'est
 *  « inerte » que si TOUTES ses configurations le sont. */
export const DECLARATIONS = [
  // ── lensFlare ────────────────────────────────────────────────────────
  {
    id: "lensFlare.ghostFill",
    effet: "lensFlare",
    mire: "mireLampes",
    declare: "Sans objet sur la voie automatique",
    param: "ghostFill",
    a: 0,
    b: 1,
    // La voie automatique = aucune source POSEE, donc `sourceIntensity` nul
    // (son defaut). Les fantomes doivent exister pour que la question ait un
    // sens : `ghostIntensity` a son defaut, `threshold` abaisse pour que la
    // mire declenche le bright-pass.
    configs: [
      {
        label: "voie automatique",
        base: { sourceIntensity: 0, ghostIntensity: 0.7, ghostCount: 5, threshold: 0.5, plume: 0, arcs: 0, veil: 0, haloIntensity: 0 },
      },
    ],
  },
  {
    id: "lensFlare.sensorSpacing",
    effet: "lensFlare",
    mire: "mireLampes",
    declare: "Sans objet a quadrillage nul",
    param: "sensorSpacing",
    a: 0.01,
    b: 0.2,
    // `sensor` a 0 est son defaut : le quadrillage capteur n'existe pas.
    // Le reste du flare est allume pour que la garde de signal passe.
    configs: [
      {
        label: "quadrillage nul",
        base: { sensor: 0, sourceIntensity: 0.8, sourceX: 0.5, sourceY: 0.35, threshold: 0.5, ghostIntensity: 0.7 },
      },
    ],
  },

  // ── lensDistortion ───────────────────────────────────────────────────
  // Les trois disent « hors du mode Laterale », donc DEUX configurations
  // chacun : Longitudinale et Anamorphique. Eprouver un seul des deux
  // prouverait l'inertie dans un seul des deux.
  ...["centerFalloff", "centerPresence", "aberrationAngle"].map((param) => ({
    id: `lensDistortion.${param}`,
    effet: "lensDistortion",
    mire: "mire",
    declare: "Sans objet hors du mode Laterale",
    param,
    a: { centerFalloff: 0.5, centerPresence: 0, aberrationAngle: -45 }[param],
    b: { centerFalloff: 4, centerPresence: 1, aberrationAngle: 45 }[param],
    configs: [
      { label: "Longitudinale", base: { aberration: 0.6, aberrationMode: 1, distortion: 0 } },
      { label: "Anamorphique", base: { aberration: 0.6, aberrationMode: 2, distortion: 0 } },
    ],
  })),

  // ── lensBlur ─────────────────────────────────────────────────────────
  {
    id: "lensBlur.bladeRotation",
    effet: "lensBlur",
    mire: "mireBokeh",
    declare: "Sans objet sur un diaphragme circulaire",
    param: "bladeRotation",
    a: 0,
    // PAS 360 : ce serait le meme angle, donc un « aucun ecart » garanti par
    // le choix des valeurs et non par le parametre.
    b: 37,
    configs: [{ label: "diaphragme circulaire", base: { blades: 0, radius: 24, highlightThreshold: 0.6, highlightBoost: 6 } }],
  },
  {
    id: "lensBlur.fieldAngle",
    effet: "lensBlur",
    mire: "mireBokeh",
    declare: "Sans objet en Uniforme et en Radial",
    param: "fieldAngle",
    a: 0,
    b: 37,
    configs: [
      { label: "Uniforme", base: { fieldShape: 0, radius: 24, blades: 6 } },
      { label: "Radial", base: { fieldShape: 3, radius: 24, blades: 6, fieldRange: 0.35, fieldFeather: 0.5 } },
    ],
  },

  // ── motionBlur ───────────────────────────────────────────────────────
  {
    id: "motionBlur.angle",
    effet: "motionBlur",
    mire: "mire",
    declare: "Sans objet en Rotation et en Zoom",
    param: "angle",
    a: 0,
    b: 37,
    configs: [
      { label: "Rotation", base: { trajectory: 1, amount: 30, centerX: 0.5, centerY: 0.5 } },
      { label: "Zoom", base: { trajectory: 2, amount: 30, centerX: 0.5, centerY: 0.5 } },
    ],
  },
  {
    id: "motionBlur.centerX",
    effet: "motionBlur",
    mire: "mire",
    declare: "Sans objet en Directionnel",
    param: "centerX",
    a: -0.5,
    b: 1.5,
    configs: [{ label: "Directionnel", base: { trajectory: 0, amount: 30, angle: 20 } }],
  },

  // ── glass ────────────────────────────────────────────────────────────
  // Base commune : ce qui fait qu'un verre REFRACTE. Sans epaisseur ni
  // dispersion, toutes les matieres rendraient la photo intacte et la garde
  // de signal tirerait sur les quinze.
  ...(() => {
    const optique = { thickness: 0.5, specular: 0.35, dispersion: 0.35, diffusion: 0.03, relief: 1, grain: 0.2 };
    const pave = (m) => ({ ...optique, material: m, blockSize: 96, mortar: 8, edgeDepth: 0.45, edgeWidth: 0.18, bevel: 0.28, inner: 0.5 });
    const feuille = (m) => ({ ...optique, material: m, density: 42, depth: 0.6, irregularity: 0.25 });
    const horsPave = [
      { label: "Cannele simple", base: feuille(0) },
      { label: "Martele", base: feuille(3) },
    ];
    return [
      {
        id: "glass.density",
        declare: "Sans objet en Poli et en Depoli",
        param: "density",
        a: 1,
        b: 200,
        configs: [
          { label: "Poli", base: { ...optique, material: 6, depth: 1, thickness: 1.6, irregularity: 0 } },
          { label: "Depoli", base: { ...optique, material: 7, diffusion: 0.4, grain: 0.6 } },
        ],
      },
      {
        id: "glass.depth",
        declare: "Sans objet en Depoli",
        param: "depth",
        a: 0,
        b: 1,
        configs: [{ label: "Depoli", base: { ...optique, material: 7, diffusion: 0.4, grain: 0.6 } }],
      },
      {
        id: "glass.profile",
        declare: "Sans objet hors de Cannele simple, Cannele croise et Gaufre",
        param: "profile",
        a: 0,
        b: 2,
        configs: [
          { label: "Martele", base: feuille(3) },
          { label: "Poli", base: { ...optique, material: 6, depth: 1, thickness: 1.6 } },
          { label: "Pave Nuage", base: pave(9) },
        ],
      },
      {
        id: "glass.flat",
        declare: "Sans objet ailleurs (regle le brossage en Aluminium)",
        param: "flat",
        a: 0,
        b: 0.9,
        // « Ailleurs » = ni les trois matieres a stries (0,1,2, ou ce curseur
        // EST le meplat), ni l'Aluminium brosse (5, ou il regle le brossage).
        // Restent DIX matieres, toutes eprouvees : la premiere passe en a
        // trouve une vivante (Martele, 47 % des canaux) et le Martele partage
        // sa primitive avec l'Ecorce — donc la question « ou exactement » ne
        // se devine pas, elle se mesure.
        configs: [
          { label: "Martele", base: feuille(3) },
          { label: "Ecorce", base: feuille(4) },
          { label: "Poli", base: { ...optique, material: 6, depth: 1, thickness: 1.6 } },
          { label: "Depoli", base: { ...optique, material: 7, diffusion: 0.4, grain: 0.6 } },
          { label: "Cathedrale", base: feuille(8) },
          { label: "Pave Nuage", base: pave(9) },
          { label: "Pave Ondule", base: pave(10) },
          { label: "Pave Quadrille", base: pave(11) },
          { label: "Pave Alveolaire", base: pave(12) },
          { label: "Pave Lisse", base: pave(13) },
        ],
      },
      {
        id: "glass.fillet",
        declare: "Sans objet hors des trois premieres matieres",
        param: "fillet",
        a: 0,
        b: 0.5,
        configs: [
          { label: "Martele", base: feuille(3) },
          { label: "Pave Nuage", base: pave(9) },
        ],
      },
      {
        id: "glass.orientation",
        declare: "Sans objet sur les matieres sans direction",
        param: "orientation",
        a: 0,
        b: 1,
        configs: [
          { label: "Cannele croise", base: feuille(1) },
          { label: "Martele", base: feuille(3) },
          { label: "Depoli", base: { ...optique, material: 7, diffusion: 0.4, grain: 0.6 } },
        ],
      },
      {
        id: "glass.irregularity",
        declare: "Sans objet en Poli et en Depoli",
        param: "irregularity",
        a: 0,
        b: 1,
        configs: [
          { label: "Poli", base: { ...optique, material: 6, depth: 1, thickness: 1.6 } },
          { label: "Depoli", base: { ...optique, material: 7, diffusion: 0.4, grain: 0.6 } },
        ],
      },
      // Les huit reglages de PAVE, tous « Sans objet hors des cinq matieres
      // Pave » : eprouves sur une matiere de feuille et sur une autre, pour
      // qu'un « inerte » ne tienne pas a une seule branche.
      ...[
        ["blockSize", 24, 512],
        ["mortar", 0, 24],
        ["mortarHue", 0, 1],
        ["mortarLightness", 0.5, 2],
        ["edgeDepth", 0, 1],
        ["edgeWidth", 0.04, 0.5],
        ["bevel", 0.04, 0.95],
        ["inner", 0, 1],
      ].map(([param, a, b]) => ({
        id: `glass.${param}`,
        declare: "Sans objet hors des cinq matieres Pave",
        param,
        a,
        b,
        configs: horsPave,
      })),
    ].map((d) => ({ ...d, effet: "glass", mire: "mireVerre" }));
  })(),

  // ── warp ─────────────────────────────────────────────────────────────
  {
    id: "warp.centerX",
    effet: "warp",
    mire: "mire",
    declare: "Sans objet en Bruit fractal, qui n'a pas de centre",
    param: "centerX",
    a: -0.5,
    b: 1.5,
    configs: [{ label: "Bruit fractal", base: { type: 0, amplitude: 0.2, scale: 3, octaves: 3, roughness: 0.5 } }],
  },

  // ── hatching ─────────────────────────────────────────────────────────
  ...["waveAmplitude", "waveFrequency"].map((param) => ({
    id: `hatching.${param}`,
    effet: "hatching",
    mire: "mire",
    declare: "Sans objet en Droites et en Cercles",
    param,
    a: { waveAmplitude: 0, waveFrequency: 0.2 }[param],
    b: { waveAmplitude: 60, waveFrequency: 40 }[param],
    configs: [
      { label: "Droites", base: { pattern: 0, spacing: 9, weight: 0.62, angle: 45 } },
      { label: "Cercles", base: { pattern: 3, spacing: 9, weight: 0.62, centerX: 0.5, centerY: 0.5 } },
    ],
  })),

  // ── outlines ─────────────────────────────────────────────────────────
  // Base commune : de quoi qu'un contour SORTE. `threshold` bas et `wash` a 1,
  // comme les scenarios existants.
  ...(() => {
    const socle = { thickness: 2.5, threshold: 0.09, softness: 0.35, wash: 1, inkHue: 210, inkSaturation: 0, inkLightness: 0.06 };
    return [
      {
        id: "outlines.chroma",
        declare: "Sans objet en entree Alpha",
        param: "chroma",
        a: 0,
        b: 1,
        configs: [{ label: "entree Alpha", base: { ...socle, inputSource: 1, detectMode: 0 } }],
      },
      {
        id: "outlines.inkMode",
        declare: "Sans objet en Echos de la forme",
        param: "inkMode",
        a: 0,
        b: 1,
        configs: [{ label: "Echos de la forme", base: { ...socle, detectMode: 2, threshold: 0.5, smoothing: 1.5, spacing: 18, echoCount: 5, falloff: 0 } }],
      },
      ...[
        ["hueOffset", 0, 360],
        ["hueSpread", 0.05, 1],
        ["wheelChroma", 0, 1],
        ["wheelLightness", 0, 1],
      ].map(([param, a, b]) => ({
        id: `outlines.${param}`,
        declare: "Sans objet en Encre unique",
        param,
        a,
        b,
        configs: [{ label: "Encre unique", base: { ...socle, inkMode: 0, detectMode: 0 } }],
      })),
      {
        id: "outlines.fill",
        declare: "Sans objet en Crete de gradient",
        param: "fill",
        a: 0,
        b: 1,
        configs: [{ label: "Crete de gradient", base: { ...socle, detectMode: 0 } }],
      },
      ...[
        ["smoothing", 0.5, 6],
        ["spacing", 2, 200],
        ["echoCount", 1, 24],
        ["falloff", 0, 1],
      ].map(([param, a, b]) => ({
        id: `outlines.${param}`,
        declare: "Sans objet hors du mode Echos",
        param,
        a,
        b,
        configs: [
          { label: "Crete de gradient", base: { ...socle, detectMode: 0 } },
          { label: "Seuil de forme", base: { ...socle, detectMode: 1, threshold: 0.5 } },
        ],
      })),
    ].map((d) => ({ ...d, effet: "outlines", mire: "mire" }));
  })(),

  // ── dither ───────────────────────────────────────────────────────────
  // DEUX DECLARATIONS NEUVES, posees le 2026-08-05 par un agent qui les a
  // DEDUITES DU SHADER et non mesurees — il l a signale lui-meme. Or ce depot
  // a une regle : une applicabilite se MESURE avant de se declarer, et elle a
  // deja ete fausse dans les deux sens. Un curseur masque a tort ne bouge plus
  // aucun pixel, donc aucune reference de rendu ne peut rougir de l erreur :
  // ces deux-la ne peuvent etre eprouvees QUE par cette sonde.
  //
  // Le raisonnement de l agent : la branche Seuil est le `return 0.0` de sortie
  // de `ditherThreshold`, celle qu aucun `if` ne teste — elle ne lit ni la
  // cellule ni sa taille.
  ...["size", "amount"].map((param) => ({
    id: `dither.${param}`,
    effet: "dither",
    mire: "mire",
    declare: "Sans objet en Seuil (declaration NEUVE, deduite du code)",
    param,
    a: { size: 1, amount: 0 }[param],
    b: { size: 32, amount: 1 }[param],
    // STYLE_SEUIL vaut 2 dans la liste des sept styles.
    configs: [{ label: "Seuil", base: { style: 2, levels: 3, mono: 1, blackPoint: 0.05, whitePoint: 0.95 } }],
  })),

  // ── gradientMap ──────────────────────────────────────────────────────
  {
    id: "gradientMap.repeatType",
    effet: "gradientMap",
    mire: "mire",
    declare: "Sans objet tant que la repetition vaut 1",
    param: "repeatType",
    a: 0,
    b: 1,
    configs: [{ label: "repetition 1", base: { repeat: 1, blackPoint: 0, whitePoint: 1, blendSpace: 1 } }],
  },
];
