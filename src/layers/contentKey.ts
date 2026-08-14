import type { LayerState } from "./types";

/**
 * CLÉ DE CONTENU d'un calque : deux calques qui rendent la même image ont la
 * même clé, qu'ils soient ou non le même objet.
 *
 * Pourquoi ce fichier existe (mesuré le 2026-08-13). La chaîne de guides du
 * pipeline (`FramePipelineExecutor.computeGuideEpochs`) comparait les calques
 * par IDENTITÉ D'OBJET. C'est correct — un objet inchangé rend la même image —
 * mais pas suffisant : un appelant en amont recopie le calque du bas à chaque
 * frame (`{...layer}`, même contenu, même id), et l'identité change alors sans
 * qu'un pixel bouge. Conséquence chiffrée sur une photo de 26 Mpx : la SAT du
 * filtre edge-aware de CHAQUE masque de la pile était reconstruite à chaque
 * image — ~25 passes — y compris en éditant un calque qui n'a rien à voir. La
 * cadence tombait de 165 à ~14 images par seconde dès qu'un masque existait.
 *
 * Le remède vient du fichier voisin : le cache du fold (`maskTextureResolver`)
 * compare un SNAPSHOT DE CONTENU et survivait, lui, à la recopie. Même donnée,
 * deux méthodes de comparaison, une seule qui tient.
 *
 * ⚠️ SENS DE L'ERREUR À PRÉSERVER. Une clé trop SENSIBLE (qui change alors que
 * l'image ne change pas) ne coûte que du travail refait — le défaut d'avant.
 * Une clé trop LAXISTE (qui reste égale alors que l'image change) sert un cache
 * périmé : un guide figé sur un ancien composite, sans erreur, sans test rouge,
 * visible seulement à l'œil sur une image fausse. Les deux ne se valent pas.
 * D'où le parcours STRUCTUREL ci-dessous plutôt qu'une liste de champs à la
 * main : un champ ajouté à `LayerState` entre dans la clé tout seul. Une liste
 * énumérée, elle, aurait oublié le champ suivant — et l'aurait oublié en
 * silence.
 */

/** Identifiants stables pour les valeurs qu'on ne peut pas sérialiser mais
 *  dont l'IDENTITÉ fait foi : rasters de masque (des `Uint8Array` de plusieurs
 *  mégaoctets — les sérialiser coûterait plus cher que le travail qu'on
 *  cherche à éviter) et objets opaques. La convention du dépôt les rend
 *  immuables : un raster est toujours REMPLACÉ, jamais muté en place
 *  (`LayerState.mask`), donc son identité EST son contenu. */
const identifiants = new WeakMap<object, number>();
let prochainIdentifiant = 1;

function identifiantDe(valeur: object): number {
  let n = identifiants.get(valeur);
  if (n === undefined) {
    n = prochainIdentifiant++;
    identifiants.set(valeur, n);
  }
  return n;
}

function estBinaire(valeur: object): boolean {
  return ArrayBuffer.isView(valeur) || valeur instanceof ArrayBuffer;
}

/** Sérialisation stable : clés d'objet TRIÉES, pour que deux objets de même
 *  contenu écrits dans un ordre différent rendent la même clé. */
function serialiser(valeur: unknown, profondeur = 0): string {
  if (valeur === null) return "null";
  if (valeur === undefined) return "undef";
  const type = typeof valeur;
  if (type === "number" || type === "boolean" || type === "bigint") return String(valeur);
  if (type === "string") return JSON.stringify(valeur);
  if (type === "function" || type === "symbol") return `@${identifiantDe(valeur as object)}`;
  const objet = valeur as object;
  if (estBinaire(objet)) return `bin${identifiantDe(objet)}`;
  // Garde de profondeur : `LayerState` est plat de deux ou trois niveaux, et
  // une structure cyclique ferait boucler à l'infini une fonction appelée à
  // chaque frame. Retomber sur l'identité est le repli SÛR (deux objets
  // distincts donnent deux clés distinctes, donc on périme au lieu de
  // servir un cache périmé).
  if (profondeur > 6) return `prof${identifiantDe(objet)}`;
  if (Array.isArray(objet))
    return `[${objet.map((element) => serialiser(element, profondeur + 1)).join(",")}]`;
  // ⚠️ NE DESCENDRE QUE DANS LES OBJETS LITTÉRAUX. Un objet d'API navigateur
  // (`GPUTexture` en tête, qui est un maillon réel de la chaîne de guides)
  // porte ses champs en ACCESSEURS DE PROTOTYPE : `Object.entries` y rend `{}`,
  // et deux textures différentes rendraient donc la MÊME clé — exactement le
  // cache périmé que ce fichier existe pour empêcher, et la plus silencieuse
  // des deux erreurs. Piège déjà payé sur `GPUAdapterInfo` (voir les gotchas de
  // la skill `run-shaderlab`) : un résultat vide se raconte une histoire
  // crédible. Ces objets-là valent par leur identité, comme les rasters.
  const prototype = Object.getPrototypeOf(objet) as object | null;
  if (prototype !== Object.prototype && prototype !== null)
    return `opaque${identifiantDe(objet)}`;
  const entrees = Object.entries(objet as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entrees.map(([cle, v]) => `${cle}:${serialiser(v, profondeur + 1)}`).join(",")}}`;
}

/**
 * Clé de contenu d'un calque. Égalité de clés ⇒ même image rendue.
 *
 * Inclut délibérément des champs qui ne changent PAS l'image (`name`,
 * `locked`) : les exclure demanderait de maintenir une liste, donc de la
 * tenir à jour à chaque champ ajouté. Les garder ne coûte qu'un travail refait
 * au renommage d'un calque — un geste rare, et l'erreur va dans le sens sûr.
 */
export function layerContentKey(layer: LayerState): string {
  return serialiser(layer);
}

/** Clé de contenu d'une valeur quelconque servant de maillon à la chaîne de
 *  guides — un `LayerState`, mais aussi la texture de toile, objet opaque donc
 *  ramenée à son identité. */
export function guideChainKey(valeur: unknown): string {
  return serialiser(valeur);
}

/** Jeton de l'APERÇU LIVE du pinceau : le masque servi change à chaque
 *  échantillon SANS nouveau `LayerState`, donc son maillon de chaîne doit
 *  périmer à chaque frame, par construction.
 *
 *  ⚠️ C'est une CLASSE et non un objet littéral, et c'est le sujet. Le jeton
 *  était `{}` du temps où la chaîne comparait des identités — deux littéraux
 *  vides y sont bien distincts. Comparés par CONTENU, ils rendent la même clé,
 *  et le jeton cesserait silencieusement de périmer : le guide d'un calque
 *  au-dessus resterait figé pendant tout le trait de pinceau. Une instance de
 *  classe tombe dans le chemin « opaque » de `serialiser`, donc porte une clé
 *  unique — la propriété d'origine, rendue explicite au lieu d'être héritée
 *  d'un détail de représentation. */
class JetonApercuLive {}

export function jetonApercuLive(): object {
  return new JetonApercuLive();
}
