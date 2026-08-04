# Presets — design doc (le COMMENT)

> **Bug différé observé le 2026-08-04** — appliquer un preset recharge aussi
> l’image avec laquelle il a été enregistré, au lieu de restaurer uniquement
> la pile d’effets. Le comportement attendu reste celui de la section 3 : les
> calques et sources photo sont exclus du document de preset. À diagnostiquer
> et corriger dans un chantier séparé ; ne pas le mélanger à la refonte
> Pile/Propriétés en cours.

> Suite de `PRD.md` § Presets (cadré 2026-07-24) et de `ARCHITECTURE.md` §3
> (module map Presets, §6 séquencement). Ce document tranche ce qu'`ARCHITECTURE.md`
> laissait ouvert au niveau implémentation — il ne rouvre pas les décisions déjà
> prises là-bas (module `presetDocument` pur, port `presetStore`, carte dockée).
>
> **Étape suivante** : `superpowers:writing-plans` sur les tranches du §7, après
> validation humaine de ce document (même statut que le doc contextual-panels au
> moment de sa relecture).

## 1. Contexte et origine

Refaire la même pile de calques à chaque photo est répétitif (`PRD.md:25`). Le
PRD cadre les comportements (§55-89) et l'archi pose déjà les frontières de
module (`ARCHITECTURE.md` §3) ; ce qui manquait était le COMMENT : forme JSON
exacte, commandes Rust précises, câblage UI réel, découpage en tranches.

**Déjà tranché, non rouvert ici** :
- Le chantier panneaux contextuels (`docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md`)
  est **livré sur cette branche** — `src/ui/contextualPanel.ts`, `src/components/dockedPanel/PanelRail.tsx`
  existent et sont câblés dans `src/App.tsx:671-673,847-853`. La dépendance de
  séquencement que le PRD laissait ouverte (`PRD.md:80-89`) est donc résolue :
  Presets s'intègre nativement à ce mécanisme, jamais comme carte isolée.
- Module map Presets (`ARCHITECTURE.md:199-306`) : `presetDocument` (pur),
  `presetStore` (port IO), carte dockée première du tableau `panels`.

## 2. Périmètre

**Dans le scope** (repris de `PRD.md:55-79`) :
- Sauvegarder / appliquer / renommer / écraser un preset.
- Confirmation avant remplacement d'une pile non vide, et avant écrasement par nom.
- "Mettre à jour" vs "créer une copie" après modification post-application.
- Dégradation gracieuse sur effet manquant du registry (calque ignoré + warning).
- Export / import JSON via dialogues natifs.
- Carte dockée "Presets", intégrée à `useContextualPanel` + `PanelRail`.

**Hors scope** (repris de `PRD.md:109-111`, ne pas construire) :
- Organisation par dossiers/tags — liste plate uniquement.
- Bibliothèque de presets fournis par défaut avec l'app.
- Tout ce qui touche à la double exposure au-delà de l'exclusion documentée au
  §3.2 (pas de "preset partiel appliqué à un calque photo", pas de transform
  dans un preset).

## 3. Modèle de données du preset

### 3.1 Ce qui est sérialisé, ce qui ne l'est pas

Un preset capture la pile de calques **sans** :
- les masques (`LayerMask`) — spécifiques à chaque photo, exigence PRD dure
  (`PRD.md:57-59`, `PRD.md:129-131`) ;
- `imageSource`/`transform` (double exposure) — un `sourceId` n'a de sens que
  dans le document qui l'a créé (`ARCHITECTURE.md:234-237`) ; un calque photo
  présent à la capture est **exclu du preset avec un avis visible**, même
  mécanisme que l'effet manquant au §5.5. C'est la réponse au point laissé
  ouvert par `ARCHITECTURE.md:529-530` (§8.3) — voir §9 "À trancher avec
  Antoine" pour la confirmation explicite requise ;
- `id` — régénéré à l'application (`ARCHITECTURE.md:232-233`), un preset ne
  réimporte jamais les ids d'un autre document.

Ce qui est capturé, un-à-un depuis `LayerState` (`src/layers/types.ts:21-41`) :
`effectId`, `params`, `enabled`, `opacity`, `blendMode`. Ordre du tableau =
ordre de la pile (bas → haut, `src/layers/types.ts` implicite via `LayerStack.layers`).

### 3.2 Forme JSON exacte

```ts
// src/presets/presetTypes.ts

export const PRESET_SCHEMA_VERSION = 1;

/** Sous-ensemble sérialisable de LayerState — délibérément SANS id/mask/
 *  imageSource/transform (§3.1). */
export interface PresetLayer {
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  opacity: number;
  blendMode: string;
}

export interface PresetDocument {
  schemaVersion: number;
  id: string;          // uuid, jamais dérivé du nom (renommer ne renomme pas le fichier)
  name: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601, mise à jour à chaque save()
  layers: PresetLayer[];
}

export interface SkipNotice {
  reason: "missing-effect" | "photo-layer";
  effectId?: string;   // présent ssi reason === "missing-effect"
}

export interface ApplyWarning {
  message: string;     // message affichable tel quel (ErrorBanner)
}
```

Fichier disque = `PresetDocument` sérialisé tel quel (`JSON.stringify(doc, null, 2)`,
lisible/diffable — cohérent avec l'annexe PRD "format texte lisible/versionnable",
`PRD.md:161-163`).

### 3.3 Versionnement

`schemaVersion` commence à 1. `presetDocument.apply()` **refuse explicitement**
un fichier dont `schemaVersion > PRESET_SCHEMA_VERSION` (version future inconnue
— jamais un parse permissif qui ignorerait silencieusement des champs). Un
fichier `schemaVersion < PRESET_SCHEMA_VERSION` passe par une chaîne de
migrations pures (`migratePresetDocument(doc): PresetDocument`, no-op tant qu'il
n'y a qu'une version) avant `apply()`. C'est le mécanisme que `ARCHITECTURE.md:471-473`
anticipe sans le construire par avance (YAGNI respecté : une seule version
existe aujourd'hui, la chaîne de migration reste vide).

### 3.4 `src/presets/presetDocument.ts` — interface exacte

```ts
export function capture(layers: LayerState[], name: string): { preset: PresetDocument; skipped: SkipNotice[] };

export function apply(
  preset: PresetDocument,
  effectExists: (effectId: string) => boolean,   // getEffect() lève — voir §5.5
  effectParams: (effectId: string) => EffectParam[] | null,
  freshId: () => string                          // même génération d'id que LayerStack
): { layers: LayerState[]; warnings: ApplyWarning[] };
```

`apply()` reconstruit des `LayerState` complets (id frais, `mask:
defaultLayerMask()`, ni `imageSource` ni `transform`) — c'est le point d'entrée
qui referme la boucle vers `LayerStack`/`DocumentSession` (§6).

Profondeur (implémentation derrière ces 2 fonctions, comme posé par
`ARCHITECTURE.md:223-237`) :
- clamp de chaque `params[name]` aux bornes `min`/`max` déclarées par
  `EffectParam` du registry courant (`src/render/effects/types.ts:6-7`) — protège
  contre une dérive de bornes entre deux versions du code, jamais un plantage
  sur une valeur hors bornes ;
- effet inconnu (`getEffect` lève `Error("Effet inconnu: ...")`,
  `src/render/effects/registry.ts:22`) → calque ignoré, `SkipNotice`/`ApplyWarning`
  poussé, jamais de `throw` qui remonterait jusqu'à l'appelant ;
- calque source portant `imageSource` → `SkipNotice{reason:"photo-layer"}` à la
  capture (§3.1).

## 4. Où vivent les presets sur disque

### 4.1 Emplacement et nommage

Dossier `presets/` sous le dossier de config app Tauri (`app.path().app_config_dir()`,
même famille d'API que `default_export_dir` qui utilise déjà `app.path().picture_dir()`,
`src-tauri/src/lib.rs:147-153`). Un fichier par preset : `{id}.json`, `id` un
uuid généré côté TS (`crypto.randomUUID()`, disponible dans le runtime WebView2/
Chromium de Tauri) — **jamais dérivé du nom affiché**, pour que renommer un
preset (double-clic, `PRD.md:64-65`) ne renomme jamais le fichier ni ne casse un
export déjà partagé sous l'ancien nom.

### 4.2 Commandes Rust — vérifié, pas supposé

Aucune commande existante ne permet d'écrire un fichier texte non-JPEG
(`ARCHITECTURE.md:267-274`, vérifié : `write_image_file` rejette tout chemin
non-`.jpg`/`.jpeg` via `is_jpeg_path`, `src-tauri/src/lib.rs:17-25,71-75` ; ni
`tauri-plugin-fs` ni `tauri-plugin-dialog` en dépendance, `src-tauri/Cargo.toml:12-19`).
`serde_json` est déjà une dépendance (`src-tauri/Cargo.toml:13`) mais n'est
utilisé par aucune commande existante — disponible si une commande a besoin de
parser côté Rust (aucune n'en a besoin ici, voir plus bas : la validation de
schéma reste en TS, Rust ne fait que de l'IO texte brute, même partage des
responsabilités que le reste du projet).

**Famille A — bibliothèque locale, confinée au dossier de config app** (nouvelles
commandes, patron `write_atomic`/`ensure_parent_dir` déjà existant,
`src-tauri/src/lib.rs:27-57`) :

```rust
fn presets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String>;   // app_config_dir()/presets
fn is_safe_preset_id(id: &str) -> bool;  // rejette tout id contenant '/', '\\', "..", ou hors [a-zA-Z0-9-]

#[tauri::command] fn list_preset_ids() -> Result<Vec<String>, String>;
#[tauri::command] fn read_preset(id: String) -> Result<String, String>;   // presets_dir/{id}.json, texte brut
#[tauri::command] fn write_preset(id: String, contents: String) -> Result<(), String>; // atomique, crée le dossier au besoin
#[tauri::command] fn delete_preset(id: String) -> Result<(), String>;
```

`is_safe_preset_id` est la vérification de préfixe/confinement exigée par
`ARCHITECTURE.md:279-283` (R7) — **rejetée côté Rust même si l'id vient d'un
`crypto.randomUUID()` TS de confiance**, défense en profondeur symétrique à
`is_jpeg_path`. Pas de commande "rename" séparée : renommer un preset =
recharger son JSON, changer `name`, `write_preset` avec le même `id`
(`PresetStore.rename`, §4.3) — le fichier ne bouge jamais.

**Famille B — export/import, chemin choisi par l'humain** (même patron que
`pick_export_folder` + `join_export_target` + `write_image_file`,
`src-tauri/src/lib.rs:158-163,136-139,59-78` — le chemin choisi par un dialogue
`rfd` transite une fois par le frontend puis revient inchangé) :

```rust
#[tauri::command] fn pick_preset_export_path(default_file_name: String) -> Option<String>; // rfd save dialog, filtre .json
#[tauri::command] fn export_preset(path: String, contents: String) -> Result<(), String>;  // refuse tout chemin non-.json (défense en profondeur, comme is_jpeg_path), écriture atomique
#[tauri::command] fn pick_preset_import_path() -> Option<String>;                          // rfd open dialog, filtre .json
#[tauri::command] fn import_preset(path: String) -> Result<String, String>;                // fs::read_to_string, AUCUNE validation de schéma ici (§3.3, en TS)
```

Les 8 commandes s'ajoutent à `tauri::generate_handler![...]` (`src-tauri/src/lib.rs:209-219`).
Ne pas réintroduire `tauri-plugin-dialog` (bug IPC connu, `CLAUDE.md` § bug
`@tauri-apps/plugin-dialog`).

### 4.3 `src/presets/presetStore.ts` — port + adapter

Interface reprise telle quelle d'`ARCHITECTURE.md:252-260`, avec `rename`
implémenté en load+patch+save (pas une commande Rust dédiée, §4.2) :

```ts
export interface PresetSummary { id: string; name: string; updatedAt: string; }

export interface PresetStore {
  list(): Promise<PresetSummary[]>;
  load(id: string): Promise<PresetDocument>;
  save(id: string, doc: PresetDocument): Promise<void>;   // écrasement = décision de l'appelant, jamais silencieux
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean>;  // false = annulé par l'utilisateur
  importFrom(): Promise<PresetDocument | null>;                              // null = annulé
}
```

`TauriPresetStore` (production) appelle `launch.ts` (§4.4, nouveaux wrappers) ;
`InMemoryPresetStore` (tests) tient une `Map<id, PresetDocument>` — même patron
que le double mémoire déjà utilisé pour `PathAvailability`
(`src/export/exportImage.ts:44-46`, testé sans IPC).

### 4.4 `src/launch.ts` — nouveaux wrappers typés

Même forme que les wrappers existants (`getLaunchPath`, `pickImageFile`, etc.,
`src/launch.ts:3-59`), un par commande de la §4.2 : `listPresetIds`,
`readPreset`, `writePreset`, `deletePreset`, `pickPresetExportPath`,
`exportPreset`, `pickPresetImportPath`, `importPreset`.

## 5. Chaque comportement PRD → mécanisme

### 5.1 Sauvegarder un preset

`presetDocument.capture(session.layers(), name)` → `presetStore.save(uuid(), preset)`.
`skipped` (calques photo exclus) affiché via le mécanisme d'avertissement
existant (`setError`, `src/App.tsx` — même `ErrorBanner` déjà câblé,
`src/components/ErrorBanner.tsx`), pas un nouveau composant.

### 5.2 Appliquer sur une pile non vide → confirmation

`session.layers().length > 0` avant d'appeler `apply()` → si vrai, une
confirmation bloque le remplacement (nouveau composant, §6.4). Une fois
confirmée : `presetDocument.apply(...)` → `session.commit(nouveau LayerStack)`
via le chemin `DocumentSession` existant (`src/application/documentSession.ts:48-52`)
— **undoable gratuitement** (`ARCHITECTURE.md:287-290`), la confirmation reste
un plancher dur en plus de l'undo, pas à sa place (exigence PRD,
`PRD.md:130-131`).

### 5.3 Sauvegarder sous un nom existant → confirmation ; renommer par double-clic

`presetStore.list()` avant `save()` détecte une collision de **nom** (pas d'id)
→ même composant de confirmation que 5.2, contenu différent. Renommer : double-clic
sur le nom dans la liste → champ éditable inline → `presetStore.rename(id, nouveauNom)`
(§4.3, aucune confirmation requise par le PRD pour un renommage, seulement pour
un écrasement).

### 5.4 Params modifiés après application → "mettre à jour" ou "créer une copie"

Le hook `usePresets` (§6.2) garde `{ activePresetId: string; snapshot: PresetLayer[] }
| null`, posé au moment de `apply()` réussi. Une fonction pure compare la pile
courante (projetée en `PresetLayer[]`, mêmes 5 champs que §3.1) au `snapshot` —
`presetsDiffer(a: PresetLayer[], b: PresetLayer[]): boolean`, testable seule.
Dès qu'elle retourne `true` alors qu'`activePresetId` est posé, un bandeau
propose "Mettre à jour «Nom»" (`presetStore.save(activePresetId, capture(...))`)
ou "Créer une copie" (nouvel id, nouveau nom demandé) — jamais une perte
silencieuse (`PRD.md:130-131`). Ajouter/retirer un calque, ou appliquer un autre
preset, efface `activePresetId` (plus de preset "actif" à comparer).

**Correction post-implémentation (revue finale de branche, 2026-07-26)** :
contrairement à ce que cette section disait initialement, **sélectionner un
autre calque n'efface PAS `activePresetId`**. Le code livré fait
délibérément l'inverse — c'est ce qui rend cette bannière atteignable du
tout : `apply()` ne sélectionne aucun calque particulier, et le premier
geste naturel après avoir appliqué un preset (cliquer un calque pour régler
ses paramètres) aurait sinon fait disparaître la bannière avant même que
l'utilisateur ait eu la chance de modifier quoi que ce soit. Voir
`selectLayer`/`normalizeSelection` dans `src/App.tsx` : `clearActive()` n'y
est posé QUE sur `openFile`/`handleAdd`/`handleRemove`/`applyPreset`, jamais
sur la sélection de calque.

Ctrl+Z/Ctrl+Y (undo/redo) ont eux aussi un traitement dédié, ajouté par la
même revue finale : `usePresets.reconcileActiveAfterHistoryChange` compare la
pile restaurée au snapshot du preset actif de façon **structurelle**
(nombre de calques + suite des `effectId`, PAS les valeurs de paramètres —
`presetStructureDiffers`, distinct de `presetsDiffer` ci-dessus) et n'efface
`activePresetId` que si cette structure a changé. Sans ce traitement, annuler
l'application même du preset (retour à une pile vide ou différente) laissait
`activePresetId` posé sur un snapshot qui ne correspondait plus à rien, et
"Mettre à jour" pouvait écraser le fichier avec la pile annulée — un bug
CRITIQUE trouvé par cette même revue. Une simple annulation de modification de
paramètre (pile structurellement identique) ne passe PAS par ce chemin : c'est
`presetsDiffer` (comparaison de valeur complète) qui continue seul à piloter
l'affichage de la bannière dans ce cas, et fait bien disparaître le bandeau
quand l'undo ramène la pile à l'état exact du preset.

### 5.5 Preset référence un effet disparu du registry

Couvert par `apply()` (§3.4) : `effectExists(effectId)` fausse → calque ignoré,
`ApplyWarning` poussé dans le tableau retourné, jamais un `throw` qui
remonterait jusqu'à l'appelant ni un silence complet (`PRD.md:69-72`). Le reste
du preset s'applique normalement. Warnings affichés via `setError` (join des
messages), même canal que 5.1.

### 5.6 Export / Import JSON

Exporter : `presetStore.exportTo(`${sanitizedName}.json`, doc)` → `pickPresetExportPath`
puis `exportPreset` (§4.2 famille B) — écrit le `PresetDocument` capturé
**tel qu'il est déjà sur disque** (pas de re-capture, pour exporter exactement
ce qui est sauvegardé). Importer : `pickPresetImportPath` → `importPreset` (texte
brut) → **validation de schéma en TS** (`schemaVersion` connu, structure
attendue — un fichier corrompu ou édité à la main échoue proprement avec un
message, jamais un plantage, cf. R8 `ARCHITECTURE.md:520`) → si valide, proposé
comme preset à sauvegarder localement (nouvel id généré à l'import, jamais
l'id du fichier importé — évite une collision avec un preset local existant)
avant d'être disponible dans la liste.

### 5.7 Placement UI

Carte "Presets" dockée, première du tableau `panels` et première du `DockLayout`
par défaut. Couvert au §6.

## 6. Intégration UI

### 6.1 Ce qui ne change pas

`src/components/dockedPanel/PanelColumn.tsx`, `DockedPanelCard.tsx`,
`src/ui/dockLayout.ts`, `src/components/dockedPanel/dockWidth.ts` — **intacts**,
même contrat que pour Calques/Réglages/Masque
(`docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md` §
Hors scope, confirmé toujours vrai par `ARCHITECTURE.md:490-493`). `useContextualPanel`
(`src/ui/contextualPanel.ts:36-48`) et `PanelRail`
(`src/components/dockedPanel/PanelRail.tsx:20-37`) sont réutilisés **sans
modification** — Presets n'a pas besoin d'un 4ᵉ cas dans le hook, il est
générique par construction (`triggerKey: string | null`).

### 6.2 `usePresets` — nouveau hook, propre à `App.tsx`

Suit le patron recommandé par `ARCHITECTURE.md:518` (R6) : chaque feature
apporte son propre hook plutôt que d'alourdir `App.tsx` directement.

```ts
function usePresets(store: PresetStore): {
  summaries: PresetSummary[];
  refresh: () => Promise<void>;
  save: (name: string) => Promise<void>;
  applyTo: (id: string, session: DocumentSession, onWarning: (msg: string) => void) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportPreset: (id: string) => Promise<void>;
  importPreset: () => Promise<void>;
  activePresetId: string | null;
  isDirty: boolean;               // §5.4
  updateActive: () => Promise<void>;
  copyActiveAsNew: (name: string) => Promise<void>;
};
```

### 6.3 Câblage `App.tsx`

Ce qui change :
- une 4ᵉ entrée dans le tableau `panels` (`src/App.tsx:779-838`), id `"presets"`,
  **avant** `"layers"` (ordre du tableau = ordre visuel dans la colonne, comme
  aujourd'hui) ;
- `const presetsPanel = useContextualPanel(true, "static");` — **même
  câblage que Calques** (`src/App.tsx:671`) : Presets n'a pas de condition
  automatique réelle (c'est un objet document-level, pas lié à une sélection
  de calque), donc `conditionMet = true` en permanence, togglable seulement via
  le rail — cohérent avec la remarque déjà faite pour Calques
  (`docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md:102-109`) ;
- `dockLayout` par défaut devient `[["presets", "layers", "params", "mask"]]`
  (`src/App.tsx:109`) — seul point de vigilance de merge partagé avec d'autres
  chantiers du dock (`ARCHITECTURE.md:502-505`, déjà anticipé) ;
- un 4ᵉ item dans `PanelRail` (`src/App.tsx:847-853`) ;
- le filtre `.filter((panel) => ...)` (`src/App.tsx:839-841`) gagne le cas `"presets"`.

Ce qui ne change pas : la mécanique de collapse/drag/largeur, déjà générique
par tableau `panels`.

### 6.4 Dialogue de confirmation : `src/ui/Dialog.tsx` existe déjà

**Correction d'une erreur de la première rédaction de ce doc** (2026-07-26) :
elle concluait qu'aucun composant de confirmation n'existait, sur la foi d'un
balayage limité à `src/components/ui/`. Le composant vit en réalité dans
`src/ui/Dialog.tsx` — modal bâtie sur l'élément natif `<dialog>`
(`showModal()`/`close()`), avec top-layer, piège de focus et Échap natifs,
`aria-labelledby`/`aria-describedby`, restauration du focus précédent, et un
slot `actions` prévu exactement pour une paire Confirmer/Annuler
(`Dialog.tsx:5-13,32-40`). Feuille de style associée : `src/ui/dialog.css`.

Il n'a **aucun consommateur** aujourd'hui (`grep "from.*Dialog\|<Dialog" src`
→ 0 résultat) : il a été écrit puis récupéré lors d'un nettoyage de branches
le 2026-07-24. Les confirmations 5.2/5.3 sont donc du CÂBLAGE, pas un nouveau
composant à concevoir.

Point d'attention documenté dans le composant lui-même
(`Dialog.tsx:25-30`) : le focus initial va au premier élément portant
`autofocus`, sinon au bouton de fermeture. Pour une confirmation destructive,
l'appelant DOIT poser `autoFocus` sur le bouton le plus sûr (Annuler).

## 7. Découpage en tranches verticales

Chaque tranche traverse les couches qu'elle concerne et finit démontrable par
elle-même (convention projet : logique pure testée unitairement, UI vérifiée
visuellement — jamais l'inverse, jamais un mélange qui masquerait l'un des deux).

**T1 — Modèle preset pur.** `presetTypes.ts`, `presetDocument.ts` (capture/apply/
clamp/skip/migration §3.3). Couches : data model uniquement. Démontrable seule :
suite Vitest (capture sans masque/imageSource, apply avec effet manquant → warning
sans throw, clamp de params hors bornes, refus `schemaVersion` future, migration
no-op v1). Zéro IO, zéro React, zéro GPU.

**T2 — Stockage disque.** 8 commandes Rust (§4.2), `presetStore.ts` (port +
`TauriPresetStore` + `InMemoryPresetStore`), wrappers `launch.ts`. Couches : IPC
Rust + frontière IPC. Démontrable seule : `cargo test` sur `is_safe_preset_id`/
`write_atomic` réutilisé/round-trip write→read→delete (même patron que les tests
`lib.rs` existants, `src-tauri/src/lib.rs:224-318`) + tests Vitest de
`TauriPresetStore` avec un `invoke` mocké.

**T3 — Carte "Presets" + sauvegarde.** `usePresets` (partiel : `save`/`summaries`/
`refresh`), câblage `App.tsx` §6.3, composant `PresetPanel` (liste + bouton
"Enregistrer preset", wireframe option 2). Couches : UI + hook + store + document
(lecture seule de `session.layers()`). Démontrable seule : Storybook pour
`PresetPanel` isolé + CDP/checkpoint humain (sauvegarder un preset dans l'app
réelle, vérifier le fichier apparaît dans le dossier de config).

**T4 — Application d'un preset.** `applyTo`, composant de confirmation (§6.4),
warning effet manquant via `setError`. Couches : UI + hook + document + logique
pure (`presetDocument.apply`, déjà couvert T1, câblé ici). Démontrable seule :
CDP/checkpoint humain (appliquer sur pile vide = pas de confirmation, sur pile
non vide = confirmation, undo après application ramène l'état précédent).

**T5 — Mettre à jour / créer une copie.** `presetsDiffer`, `activePresetId`/
`isDirty` dans `usePresets`, bandeau UI. Couches : logique pure + hook + UI.
Démontrable seule : test unitaire `presetsDiffer` (identique → false, param
changé → true, ordre de calque changé → true) + CDP (modifier un param après
application fait apparaître le bandeau).

**T6 — Export / Import.** 4 commandes Rust restantes (famille B, si pas déjà
faites en T2 — regroupables si le rythme d'implémentation le permet, sinon
tranche séparée), boutons Exporter/Importer dans `PresetPanel`, validation de
schéma à l'import. Couches : Rust + store + UI. Démontrable seule : cargo test
sur la fonction pure de validation d'extension `.json` (même patron que
`join_export_filename`, `src-tauri/src/lib.rs:126-139,297-300`) + CDP (export
réel, ré-import du fichier produit, import d'un fichier corrompu → message
propre sans plantage).

Ordre imposé par dépendances réelles : T1 avant T2/T3/T4/T6 (tous consomment
`capture`/`apply`) ; T2 avant T3 (la carte a besoin d'un store pour lister) ;
T3 avant T4/T5 (il faut une liste avant de pouvoir en appliquer un) ; T6
indépendante de T4/T5 après T2 (peut être menée en parallèle).

## 8. Ce qui se teste unitairement, ce qui ne se teste pas

Convention dure du projet, non négociable (`CLAUDE.md` § Stack : "Vitest (Node
env, aucun test ne rend de composant React)") :

**Testé unitairement (Vitest, Node, sans DOM ni GPU)** :
- `presetDocument.capture`/`apply`/migration/clamp (T1).
- `presetsDiffer` (T5).
- `TauriPresetStore` avec `invoke` mocké — vérifie la forme des appels IPC, pas
  le rendu (T2).
- `InMemoryPresetStore` comme double dans les tests d'autres modules qui
  consomment `PresetStore` sans vouloir de vrai IPC.

**Testé (Rust, `cargo test`, sans IPC réel)** :
- `is_safe_preset_id`, round-trip `write_preset`/`read_preset`/`delete_preset`
  sur un fichier temporaire, validation d'extension `.json` (T2/T6) — même
  patron que les tests déjà présents pour `is_jpeg_path`/`write_atomic`/
  `join_export_filename` (`src-tauri/src/lib.rs:228-317`).

**Jamais testé unitairement, vérifié visuellement (CDP + checkpoint humain,
`CLAUDE.md` § Moyen de preuve)** :
- `PresetPanel`, le composant de confirmation, le bandeau "mettre à jour/copier",
  tout rendu de `usePresets` dans `App.tsx`.
- Le câblage réel `PanelRail`/`useContextualPanel` pour l'item Presets (le hook
  lui-même est déjà testé, `contextualPanel.test.ts` existant — pas à
  retester, seul le CÂBLAGE est visuel).

## 9. Risques / points d'attention

| # | Risque | Mitigation |
|---|---|---|
| P1 | ~~Aucun composant de confirmation dans le design system actuel~~ — **erreur de la première rédaction, corrigée** : `src/ui/Dialog.tsx` existe (§6.4). | Plus de risque : câblage d'un composant existant, non testé en usage réel (0 consommateur à ce jour) — première utilisation à vérifier au checkpoint visuel de T4. |
| P2 | **Fichier preset édité à la main, malformé ou avec un `schemaVersion` absent.** | `apply()`/l'import valident la structure AVANT tout usage — un JSON qui ne respecte pas `PresetDocument` échoue avec un message explicite, jamais un plantage (R8 `ARCHITECTURE.md:520`). |
| P3 | **Collision de nom sans collision d'id** (deux presets différents nommés pareil après un import) — le PRD ne demande l'unicité que pour l'écrasement volontaire (5.3), pas une contrainte globale. | Assumé : les noms ne sont PAS uniques en base, seule une sauvegarde EXPLICITE sous un nom déjà pris déclenche la confirmation d'écrasement — un import qui crée un doublon de nom est silencieusement accepté (comportement volontaire, à confirmer si contre-intuitif en usage réel). |
| P4 | **`activePresetId` perdu au changement de session/document** — pas de persistance de "quel preset est actif" entre deux photos ni au redémarrage de l'app, cohérent avec `History` déjà session-only (`CONTEXT.md:66-68`). | Assumé sans besoin de confirmation — aucune exigence PRD contraire. |
| P5 | **Presets × double exposure non couvert par le PRD** (§3.1, exclusion à la capture). | Décision d'architecture déjà recommandée (`ARCHITECTURE.md:234-237`), reprise ici — confirmation explicite demandée ci-dessous, pas bloquante pour T1-T4 (aucun calque photo tant que la double exposure n'est pas utilisée en pratique par le testeur). |

### Points tranchés par Antoine (2026-07-26) — plus rien en attente

1. ~~Forme visuelle du dialogue de confirmation~~ — **tranché** :
   `src/ui/Dialog.tsx` existe et sert (§6.4). Plus rien à concevoir ni à
   choisir ; T3 et T4 peuvent partir.

2. **Exclusion des calques photo à la capture → CONFIRMATION BLOQUANTE**
   (§3.1, P5). L'avertissement simple proposé par défaut est écarté : capturer
   un preset amputé d'un calque photo sans que l'utilisateur l'ait accepté
   produirait un preset silencieusement incomplet, exactement le type de perte
   silencieuse que le PRD interdit (`PRD.md:129-131`). Mécanisme : même
   `Dialog` que 5.2/5.3, avant écriture du preset, énumérant les calques
   exclus. `autoFocus` sur Annuler (bouton le plus sûr, cf. `Dialog.tsx:25-30`).
   Annuler = aucun fichier écrit.

3. **Import qui crée un doublon de nom → RENOMMAGE EN `<nom> (copie)`**
   (P3). Ni silencieux ni bloquant : l'import aboutit toujours, mais le preset
   entrant est renommé pour que les deux restent distinguables dans la liste.
   Collisions successives : `(copie)`, `(copie 2)`, `(copie 3)`… — le premier
   suffixe libre. Ce comportement est de la logique PURE (une fonction de
   résolution de nom prenant les noms existants et le nom entrant), donc
   testable unitairement, et il doit l'être : c'est la seule garantie que la
   suite de suffixes ne boucle pas et ne réintroduit pas de collision.

## 10. Vérification contre le PRD

Chaque puce `PRD.md:55-89` a son mécanisme désigné :

| Comportement PRD | Traité en |
|---|---|
| Sauvegarder → capture sans masques | §3.1, §3.4, §5.1 |
| Appliquer sur pile non vide → confirmation | §5.2, §6.4 |
| Écraser par nom → confirmation ; renommer par double-clic | §5.3 |
| Params modifiés après application → mettre à jour / créer une copie | §5.4 |
| Effet disparu du registry → calque ignoré + avertissement | §3.4, §5.5 |
| Export/Import JSON, pas de réseau | §4.2 (famille B), §5.6 |
| Carte dockée dédiée, première de la colonne | §5.7, §6.1, §6.3 |
| Intégration `useContextualPanel` + `PanelRail` (dépendance de séquencement) | §1, §6.1, §6.3 |
