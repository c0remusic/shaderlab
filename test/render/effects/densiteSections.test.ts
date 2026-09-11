import { describe, expect, it } from "vitest";
import { effectRegistry } from "../../../src/render/effects/registry";
import { developModules } from "../../../src/render/developRegistry";
import type { EffectModule, SectionLayout } from "../../../src/render/effects/types";

// Densité et orphelins couvrent le registre des effets ET les modules de
// l'ÉTAGE de développement (ticket 03) : ils portent des sections et des
// paramètres orphelins comme n'importe quel effet (`etalonnage.shadowTint` est
// un orphelin déclaré), et sont rendus par le MÊME `ParamPanel`. `etalonnage`
// ayant quitté `effectRegistry` pour l'étage, sans cette réunion son orphelin
// déclaré deviendrait « périmé » et le second test rougirait.
const modulesEtEtage = [...effectRegistry, ...developModules];

/**
 * DENSITÉ DES SECTIONS ET ORPHELINS — le garde du ticket 16.
 *
 * Ce que le ticket exigeait pour déclarer son front fini : un plafond de densité
 * **chiffré et opposable**, aucun effet au-dessus, et **zéro orphelin sans raison
 * écrite**. Il ajoutait, et c'est la raison d'être de ce fichier : « la mesure de
 * sortie se relance et doit tenir toute seule ».
 *
 * Une prose ne tient pas toute seule. Les neuf orphelins de `duotone` sont nés
 * d'une correction de densité JUSTE — ses trois sections d'encre répétaient le
 * libellé de leur pastille, ce qu'ADR-0001 refuse — et **rien ne les a
 * signalés**, parce qu'aucun test ne comptait les paramètres non cités. Corriger
 * la densité d'un côté avait créé un défaut de l'autre.
 *
 * ── DEUX DÉNOMINATEURS FAUX, CORRIGÉS ICI ──────────────────────────────────
 *
 * **1. La rangée, et non le paramètre.** Un `EffectParam` n'est pas une ligne de
 * panneau. Quatre familles sont consommées par un contrôle COMPOSITE et n'ont
 * aucune ligne à elles : les points d'une courbe (ils se manipulent dans le
 * tracé), les arrêts d'une rampe, les quatre bornes d'une plage tonale, et les
 * satellites d'un `colorGroup` — trois paramètres, UNE pastille. Compter les
 * paramètres est l'erreur qui a fait écrire « `curves`, 37 paramètres, le plus
 * chargé du parc » : il en rend **13**.
 *
 * **2. La ligne visuelle, et non la rangée.** `grille` et `paire` posent DEUX
 * colonnes — leur CSS le dit et c'est leur seule raison d'être. Huit rangées en
 * grille font quatre lignes à défiler. Le tableau de densité du ticket comparait
 * des sections `liste` à des sections `grille` sur le même axe, ce qui classait
 * `glass.pave` (8 rangées, 4 lignes) comme plus dense que `gooeyMerge.fusion`
 * (7 rangées, 7 lignes).
 *
 * C'est cette seconde correction qui a répondu à la question du ticket — « le
 * vrai levier est-il le découpage ou le GABARIT ? » : **le gabarit**. Cinq
 * sections étaient au-dessus du plafond, quatre sont passées en `grille`, et
 * **aucune n'a été scindée ni renommée**. Le vocabulaire étant fermé et déjà
 * suffisant, le front n'a demandé aucun code.
 */

/** Colonnes d'un gabarit — mesuré sur `ParamPanel.css`, pas supposé. */
function colonnes(layout: SectionLayout): number {
  return layout === "grille" || layout === "paire" ? 2 : 1;
}

/** Paramètres consommés par un contrôle composite, donc SANS ligne propre. */
function paramsSansLigne(effet: EffectModule): Set<string> {
  const consommes = new Set<string>();
  for (const courbe of effet.curveControls ?? []) {
    for (const canal of courbe.channels) {
      consommes.add(canal.startY);
      consommes.add(canal.endY);
      for (const point of canal.points) {
        consommes.add(point.x);
        consommes.add(point.y);
      }
    }
  }
  const plage = effet.tonalRangeControl;
  if (plage) {
    for (const nom of [plage.shadowsMin, plage.shadowsMax, plage.highlightsMin, plage.highlightsMax]) {
      consommes.add(nom);
    }
  }
  for (const rampe of effet.colorRampControls ?? []) {
    consommes.add(rampe.blackPoint);
    consommes.add(rampe.whitePoint);
    for (const arret of rampe.stops) {
      consommes.add(arret.hue);
      consommes.add(arret.saturation);
      consommes.add(arret.lightness);
    }
  }
  return consommes;
}

/** Rangées d'une liste de noms : un `colorGroup` compte pour UNE (sa pastille),
 *  les autres pour une chacun, les consommés pour zéro. */
function rangees(effet: EffectModule, noms: readonly string[]): number {
  const consommes = paramsSansLigne(effet);
  const pastilles = new Set<string>();
  let compte = 0;
  for (const nom of noms) {
    const param = effet.params.find((p) => p.name === nom);
    if (!param || consommes.has(nom)) continue;
    if (param.colorGroup) {
      pastilles.add(param.colorGroup.key);
      continue;
    }
    compte += 1;
  }
  return compte + pastilles.size;
}

/** Ce que l'utilisateur DÉFILE : les rangées réparties sur les colonnes du
 *  gabarit. C'est la seule mesure qui compare deux gabarits sans mentir. */
function lignesVisuelles(effet: EffectModule, section: { layout: SectionLayout; params: readonly string[] }): number {
  return Math.ceil(rangees(effet, section.params) / colonnes(section.layout));
}

/**
 * PLAFOND DE DENSITÉ — six lignes visuelles par section.
 *
 * Il n'est pas inventé : c'est la hauteur de la section la plus chargée du parc
 * une fois les quatre passages en `grille` faits. **Six sections y sont
 * exactement**, donc le chiffre est calé sur le parc réel et non posé au hasard
 * — c'est ce que le second test vérifie.
 *
 * Il est OPPOSABLE au sens d'ADR-0001, c'est-à-dire au moment où le composant
 * s'écrit : la septième ligne fait rougir, et la sortie nomme la section fautive.
 * Même forme que la règle des 56 px, exception écrite comprise.
 *
 * ⚠️ Si un effet a besoin de plus, la première réponse n'est PAS de monter ce
 * nombre ni de scinder : c'est de regarder le GABARIT. Le vocabulaire est fermé
 * à cinq (`liste` · `paire` · `grille` · `pose` · `figure`) et deux d'entre eux
 * tiennent le même contenu dans deux fois moins de hauteur.
 */
const PLAFOND_LIGNES = 6;

/**
 * SECTIONS AU-DESSUS DU PLAFOND, AVEC LEUR RAISON.
 *
 * ADR-0001 admet « à justifier par écrit ou à réduire » pour la hauteur d'une
 * ligne ; c'est la même forme ici. Une exception non écrite n'existe pas.
 */
const EXCEPTIONS_DENSITE: Readonly<Record<string, string>> = {
  // Deux PASTILLES, et une pastille est un contrôle repliable, pas un curseur.
  // `channelMixer` a écarté `grille` pour cette raison exacte et l'a écrit :
  // « deux colonnes étroites tronqueraient les uns et déformeraient l'autre ».
  // Sa hauteur est le prix d'un contrôle qui n'entre pas en demi-largeur.
  "outlines.encre": "deux pastilles — `grille` les déformerait (précédent channelMixer)",
};

/**
 * ORPHELINS DÉCLARÉS — un paramètre qu'aucune section ne cite, ET SA RAISON.
 *
 * C'est la réponse du ticket à « un garde est-il possible, ou est-ce forcer une
 * prose dans un test ? ». La prose reste dans le module, à la déclaration ; ce
 * qui vit ici est la LISTE. Ajouter un orphelin sans venir écrire sa ligne fait
 * rougir — « personne ne l'a vu » devient « ça rougit ».
 *
 * Ils sont MESURÉS, pas recopiés d'un document : la première version de ce
 * fichier en avait deviné dix-sept, dont aucun n'était juste.
 */
const ORPHELINS_DECLARES: Readonly<Record<string, string>> = {
  // `lensFlare` : ce qui est COMMUN à plusieurs phénomènes. Le seuil et
  // l'étalement fabriquent le champ de hautes lumières que lisent les fantômes,
  // l'anneau ET le voile ; la source posée alimente les trois familles ; la
  // teinte les colore toutes sauf le quadrillage. Les enfermer dans une section
  // les rattacherait à un phénomène qui ne les possède pas.
  "lensFlare.threshold": "commun aux trois phénomènes",
  "lensFlare.spread": "commun aux trois phénomènes",
  "lensFlare.sourceX": "la source posée alimente les trois familles",
  "lensFlare.sourceY": "la source posée alimente les trois familles",
  "lensFlare.sourceRadius": "la source posée alimente les trois familles",
  "lensFlare.sourceIntensity": "la source posée alimente les trois familles",
  "lensFlare.tintHue": "teinte du traitement, commune à tout sauf au quadrillage",
  "lensFlare.tintSaturation": "teinte du traitement, commune à tout sauf au quadrillage",
  "lensFlare.tintLightness": "teinte du traitement, commune à tout sauf au quadrillage",
  // `channelMixer` : aucun n'est le réglage d'UN canal de sortie, donc le ranger
  // sous l'un d'eux le dirait faux. Une section « Commun » serait un titre pour
  // dire « tout le reste ».
  "channelMixer.preserveLuma": "porte sur la matrice entière, pas sur un canal",
  "channelMixer.monochrome": "porte sur la matrice entière, pas sur un canal",
  "channelMixer.transferSpace": "choisit la courbe de toute la matrice",
  "channelMixer.colorize": "dose les trois encres ensemble",
  // `curves` : le dosage de l'effet entier, au-dessus de ses quatre canaux.
  "curves.mix": "dose l'effet entier, au-dessus des quatre canaux",
  // `gradientMap` : deux réglages qui portent sur le mappage complet.
  "gradientMap.preserveShading": "porte sur le mappage complet",
  "gradientMap.blendSpace": "espace de mélange de tout l'effet",
  // `etalonnage` : la nuance foncée n'appartient à aucune primaire. Une section
  // « Nuance foncée » d'un seul item est exactement ce qu'ADR-0001 proscrit — un
  // titre pour une ligne. Rendue à sa place (index 0), elle retombe en tête,
  // comme dans Lightroom.
  "etalonnage.shadowTint": "vert↔magenta des ombres, hors des trois primaires",
};

describe("densité des sections", () => {
  it("aucune section ne dépasse le plafond, sauf exception écrite", () => {
    const depassements: string[] = [];
    for (const effet of modulesEtEtage) {
      for (const section of effet.sections ?? []) {
        const cle = `${effet.id}.${section.id}`;
        const n = lignesVisuelles(effet, section);
        if (n > PLAFOND_LIGNES && !(cle in EXCEPTIONS_DENSITE)) {
          depassements.push(`${cle} = ${n} lignes (gabarit ${section.layout})`);
        }
      }
    }
    expect(depassements).toEqual([]);
  });

  it("le plafond MORD — plusieurs sections l'atteignent exactement", () => {
    // Un plafond que rien n'approche ne prouve rien : il pourrait valoir 40. Ce
    // test dit que le chiffre est calé sur le parc réel.
    const hauteurs = modulesEtEtage.flatMap((effet) =>
      (effet.sections ?? []).map((s) => lignesVisuelles(effet, s)),
    );
    expect(hauteurs.filter((h) => h === PLAFOND_LIGNES).length).toBeGreaterThanOrEqual(3);
  });

  it("une exception de densité ne survit pas à sa raison", () => {
    // Si la section repasse sous le plafond, sa dérogation doit SORTIR — sinon
    // la liste devient un cimetière et la prochaine vraie exception s'y cache.
    const encoreHautes = new Set(
      modulesEtEtage.flatMap((effet) =>
        (effet.sections ?? [])
          .filter((s) => lignesVisuelles(effet, s) > PLAFOND_LIGNES)
          .map((s) => `${effet.id}.${s.id}`),
      ),
    );
    const perimees = Object.keys(EXCEPTIONS_DENSITE).filter((cle) => !encoreHautes.has(cle));
    expect(perimees, "exceptions devenues inutiles").toEqual([]);
  });
});

describe("orphelins de section", () => {
  it("tout paramètre non cité par une section porte sa raison déclarée", () => {
    const inattendus: string[] = [];
    for (const effet of modulesEtEtage) {
      const sections = effet.sections ?? [];
      if (sections.length === 0) continue;
      const cites = new Set(sections.flatMap((s) => s.params));
      for (const param of effet.params) {
        if (cites.has(param.name)) continue;
        const cle = `${effet.id}.${param.name}`;
        if (!(cle in ORPHELINS_DECLARES)) inattendus.push(cle);
      }
    }
    expect(inattendus, "orphelins sans raison déclarée").toEqual([]);
  });

  it("la liste des orphelins déclarés ne se périme pas en silence", () => {
    const reels = new Set(
      modulesEtEtage.flatMap((effet) => {
        const sections = effet.sections ?? [];
        if (sections.length === 0) return [];
        const cites = new Set(sections.flatMap((s) => s.params));
        return effet.params.filter((p) => !cites.has(p.name)).map((p) => `${effet.id}.${p.name}`);
      }),
    );
    const perimes = Object.keys(ORPHELINS_DECLARES).filter((cle) => !reels.has(cle));
    expect(perimes, "déclarés orphelins mais cités par une section").toEqual([]);
  });
});
