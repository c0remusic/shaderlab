import { computeAccessibleName } from "dom-accessibility-api";

/**
 * INSTRUMENT DE TEST — importé UNIQUEMENT par des `*.stories.tsx`, jamais par
 * du code de l'application (il tirerait `dom-accessibility-api` dans le
 * bundle). Il vit sous `src/components/ui/` pour être à côté de ce qu'il
 * mesure, avec le suffixe `.test-support` pour que sa nature soit lisible sans
 * l'ouvrir.
 *
 * POURQUOI IL EXISTE. Le 2026-07-30, un relevé DOM a conclu que les quatre
 * champs numériques du panneau Photo n'avaient « aucun nom accessible », sur la
 * base de `aria-label || name || id` : trois attributs qui ne calculent PAS un
 * nom accessible. Un champ nommé par un `<label htmlFor>` associé — le cas de
 * `NumberField` — tombe dans le `|| id` et ressort sous l'identifiant généré
 * par React (`_r_2n_`). Le défaut était dans l'instrument, pas dans l'UI.
 *
 * D'où les deux exigences de ce module :
 *   1. le nom se CALCULE (accname, spec W3C) au lieu d'être lu dans un
 *      attribut — `computeAccessibleName` est l'implémentation de référence,
 *      celle dont `@testing-library/dom` se sert pour `getByRole({ name })` ;
 *   2. un nom qui ressemble à un identifiant généré est REJETÉ, pas accepté.
 *      Sans cette seconde condition le garde ne garde rien : le relevé fautif
 *      passerait au vert avec ses `_r_2n_`.
 */

/** Formes d'identifiant générées par `React.useId` selon la version :
 *  `_r_2n_` (19), `«r2n»` (18 prod), `:r2n:` (18 dev). Un nom accessible qui a
 *  cette forme n'est pas un nom — c'est un identifiant qui a fui. */
const GENERATED_ID_SHAPE = /^(_r_[0-9a-z]*_|«r[0-9a-z]*»|:r[0-9a-z]*:)$/i;

export interface AccessibleNameReport {
  /** De quoi retrouver l'élément à l'œil dans le DOM de la story. */
  readonly element: string;
  readonly name: string;
  /** `null` = conforme. Sinon, la raison du rejet, en clair. */
  readonly problem: string | null;
}

function describe(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute("type");
  const id = element.getAttribute("id");
  const role = element.getAttribute("role");
  return `<${tag}${type ? ` type="${type}"` : ""}${role ? ` role="${role}"` : ""}${id ? ` id="${id}"` : ""}>`;
}

/**
 * Contrôles de saisie du dock. Les widgets Base UI ne sont PAS des `<input>` :
 * une liste déroulante est un `<button role="combobox">`, une case à cocher un
 * `<span role="checkbox">`, une piste un `[role="slider"]`. Les omettre
 * laisserait le garde aveugle sur la moitié des contrôles.
 */
export const CONTROL_SELECTOR = 'input, textarea, select, [role="slider"], [role="checkbox"], [role="combobox"], [role="switch"], [role="spinbutton"]';

/**
 * `true` si l'élément est retiré de l'arbre d'accessibilité, donc invisible pour
 * un lecteur d'écran et hors du périmètre d'un nom accessible.
 *
 * Ce n'est PAS une exemption de confort : Base UI double chaque widget d'un
 * `<input aria-hidden="true" tabindex="-1">` en `clip-path: inset(50%)`, qui ne
 * porte que la valeur pour la soumission de formulaire. Le contrôle réellement
 * exposé est son frère (`role="combobox"`/`"checkbox"`), et c'est LUI que ce
 * module doit juger. Exiger un nom du doublon caché n'aurait aucun sens ;
 * l'exclure sans le dire en aurait encore moins.
 */
function isHiddenFromAccessibilityTree(element: Element): boolean {
  return element.closest('[aria-hidden="true"], [hidden]') !== null;
}

/**
 * Mesure le nom accessible de chaque contrôle sous `root`, en ignorant ceux qui
 * sont hors de l'arbre d'accessibilité.
 *
 * `selector` par défaut : `CONTROL_SELECTOR`. Un appelant qui veut cibler les
 * seuls champs numériques passe son propre sélecteur.
 */
export function auditAccessibleNames(root: ParentNode, selector = CONTROL_SELECTOR): AccessibleNameReport[] {
  return Array.from(root.querySelectorAll(selector)).filter((element) => !isHiddenFromAccessibilityTree(element)).map((element) => {
    const name = computeAccessibleName(element).trim();
    const ownId = element.getAttribute("id");
    let problem: string | null = null;
    if (name === "") {
      problem = "nom accessible vide";
    } else if (GENERATED_ID_SHAPE.test(name)) {
      problem = `nom accessible = identifiant généré (« ${name} »)`;
    } else if (ownId !== null && name === ownId) {
      // Le tell exact du relevé fautif du 2026-07-30 : le « nom » lu était
      // l'attribut `id` de l'élément lui-même.
      problem = `nom accessible identique à l'id de l'élément (« ${name} »)`;
    }
    return { element: describe(element), name, problem };
  });
}

/**
 * Lève si un seul contrôle sous `root` n'a pas de nom accessible utilisable.
 *
 * Lève AUSSI quand le balayage ne trouve aucun contrôle : un garde qui balaie
 * zéro élément est vert pour la mauvaise raison (règle C4 — un scan qui ne
 * trouve rien doit prouver qu'il a balayé).
 */
export function assertAccessibleNames(root: ParentNode, selector?: string): AccessibleNameReport[] {
  const report = auditAccessibleNames(root, selector);
  if (report.length === 0) {
    throw new Error(`assertAccessibleNames : aucun contrôle trouvé pour « ${selector ?? CONTROL_SELECTOR} » — balayage vide, donc sans valeur.`);
  }
  const failures = report.filter((entry) => entry.problem !== null);
  if (failures.length > 0) {
    const lines = failures.map((entry) => `  ${entry.element} → ${entry.problem}`).join("\n");
    throw new Error(`${failures.length} contrôle(s) sur ${report.length} sans nom accessible utilisable :\n${lines}`);
  }
  return report;
}
