# La fusion des réglages redondants

Type: grilling
Status: open
Parent: ../map.md

## Question

Le chantier « rationalisation des contrôles » avait **trois branches**, écrites
dans `docs/INDEX.json` :

1. **applicabilité conditionnelle** (masquer au lieu du « Sans objet en … ») ;
2. **fusion des réglages redondants** ;
3. **tri par catégories**.

Mesuré le 2026-08-12 :

| Branche | État |
| --- | --- |
| Applicabilité conditionnelle | ✅ **livrée** — `EffectParam.appliesWhen` + `EffectSection.appliesWhen` (`effects/types.ts:64`), **19 effets, 42 déclarations**, plus 10 `CanvasControl.visibleWhen`, et une gate qui les MESURE (`render-check.mjs --applicabilite`) |
| Tri par catégories | ✅ **livré** — `EFFECT_CATEGORIES` dans `effects/catalog.ts`, six catégories éditoriales |
| **Fusion des réglages redondants** | ⚠️ **aucune trace** |

Le plan `2026-08-04-rationalisation-des-controles.md` est marqué
« ✅ TERMINÉ le 2026-08-05 — contrat, panneau et déclarations sur les 22
effets ». Il ne mentionne pas la fusion.

**Cette branche a-t-elle été faite, abandonnée, ou simplement oubliée — et
faut-il la faire ?**

## ⚠️ Le motif qui rend ce ticket nécessaire

`docs/INDEX.json` écrit que ce chantier avait **déjà été ROUVERT une fois**,
« parce que le précédent n'avait traité que les contrôles spécialisés et avait
été clôturé comme s'il était complet ».

**C'est arrivé une seconde fois, sur une autre branche.** Un chantier à trois
branches en a livré deux et a été déclaré terminé. Personne n'a menti : le plan
décrit fidèlement ce qu'il a fait. C'est la CLÔTURE qui a porté sur le chantier
entier alors que le plan ne couvrait qu'une partie de son périmètre.

Avant de rouvrir quoi que ce soit, poser la question de méthode : qu'est-ce qui
empêcherait une troisième occurrence ?

## Ce qu'il faut interroger

- **Y a-t-il vraiment de la redondance ?** Ça se mesure avant de se décider.
  Les effets les plus chargés au 2026-08-04 sont `curves` (37 paramètres),
  `lensFlare` (30), `outlines` (26). ⚠️ **Ne pas compter les `name:` du
  fichier source** — les 32 paramètres de `curves` sortent d'un `flatMap` et le
  grep n'en voit que 5. Compter `EffectModule.params.length`, comme la mesure
  du 2026-08-04.
- **Redondance DANS un effet, ou ENTRE effets ?** Deux problèmes distincts. Le
  second est déjà traité par une règle du dépôt (le doublon se mesure avant de
  s'écrire, cinq effets retirés le 2026-08-03) ; le premier n'a jamais été
  regardé.
- **Fusionner n'est pas masquer.** L'applicabilité CACHE un curseur sans objet ;
  fusionner en SUPPRIME un en reportant sa fonction sur un autre. Le premier est
  réversible et gratuit, le second casse les presets — voir la contrainte dure
  ci-dessous. Ne pas croire que la branche 1 a rendu la branche 2 inutile ; c'est
  peut-être vrai, et c'est précisément ce qu'il faut trancher.
- **Le vrai problème est-il le NOMBRE ou la LISIBILITÉ ?** Un panneau de 37
  curseurs bien sectionnés peut se lire mieux qu'un de 20 en vrac. La branche 1
  et les sections ont peut-être déjà résolu le symptôme sans toucher au compte.
  Si c'est le cas, la réponse est « fusion sans objet », et elle s'écrit.

## Contrainte dure, non négociable

**L'index d'un paramètre est PERSISTÉ dans les presets.** `params[]` ne se
réordonne jamais, et un paramètre ne se retire pas sans casser les presets qui
le citent — contrairement à un effet retiré, que `presetDocument.ts` sait
ignorer avec un avertissement.

Toute fusion doit donc dire ce qu'elle fait des index libérés, et le prouver :
soit une sentinelle qui les gèle, soit une migration de document versionnée.
C'est le point qui rend cette branche plus chère que les deux autres, et
peut-être la raison pour laquelle elle est restée en arrière.

## Ce qui existe déjà et qu'il ne faut pas réinventer

`EffectParam.maxFrom` (maximum dynamique), `EffectPass.enabled` (passe
conditionnelle), `DisplayCondition` (le type partagé par `appliesWhen` et
`visibleWhen`), et les trois contrôles TRANSVERSAUX (`blendSpace`, `inputMode`,
`inkTexture`) — ce dernier étant précisément l'exemple d'une propriété
récurrente factorisée hors des effets au lieu d'être recopiée. **C'est le
patron d'une fusion réussie**, et il est déjà dans le dépôt.

## Une sortie de portée est une réponse valide

« La branche 1 et les sections ont résolu le problème, la fusion est sans
objet » est une conclusion parfaitement légitime — à condition d'être écrite
dans **Out of scope** avec sa raison, et non laissée en suspens une troisième
fois.
