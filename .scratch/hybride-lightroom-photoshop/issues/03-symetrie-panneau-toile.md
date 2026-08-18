# La symétrie panneau / toile

Type: grilling
Status: open
Parent: ../map.md
Blocked by: 01

## Question

Chez Photoshop, une forme se règle **au même titre** depuis le panneau
Propriétés et depuis la toile : W, H, X, Y, l'angle et les rayons y sont les
mêmes grandeurs, dans les mêmes unités
([recherche 01](../research/01-conventions-adobe.md)).

**Chez nous, les deux surfaces ne montrent pas la même chose.** Le panneau donne
`largeur` et `hauteur` en FRACTION du cadre ; la toile donne des poignées qu'on
tire en pixels. Un utilisateur qui vient de tirer une poignée ne peut lire nulle
part ce qu'il a fait dans une unité qu'il reconnaît.

## Pourquoi ce n'est pas qu'un problème d'affichage

La fraction n'est pas un caprice : **c'est ce qui rend un preset indépendant de
la définition de la photo.** Un aplat à `largeur: 0.8` couvre 80 % du cadre sur
une photo de 6 000 px comme sur une de 1 200. Passer les paramètres en pixels
casserait cette propriété, et avec elle la portabilité des presets.

Donc la question n'est pas « quelle unité stocker » — elle est tranchée — mais
**quelle unité MONTRER, et à quel prix**.

## Ce qu'il faut interroger

- **Une conversion à l'affichage seul suffit-elle ?** Le panneau connaît
  `imageSize` ; afficher `0.8 → 4992 px` est une multiplication. Mais un champ
  qui affiche des pixels doit aussi les ACCEPTER en saisie, sinon il ment sur ce
  qu'il est.
- **Ou deux champs ?** ADR-0001 refuse deux surfaces pour une même valeur, et le
  ticket 27 vient de payer cette règle. Un couple « fraction + pixels » serait
  exactement ce cas.
- **Le retour chiffré PENDANT le geste est-il la vraie réponse ?** Photoshop
  montre les dimensions en tirant. Si le geste dit sa mesure, le panneau n'a
  peut-être pas à changer d'unité du tout — et l'écart 5 du
  [ticket 01](01-le-geste-de-la-forme.md) et celui-ci se répondent l'un l'autre.
- **La question déborde-t-elle l'aplat ?** `lightLeak`, `motionBlur`,
  `pixelStretch` et `lensFlare` ont aussi des contrôles sur la toile dont les
  paramètres sont en pourcentage. Trancher pour l'aplat seul créerait deux
  conventions.

## Contraintes dures

- `params[]` ne se réordonne jamais ; les unités déclarées (`percent`,
  `degrees`, `pixels`) sont lues par `validateEffect` et par le genre `box`.
- Une boîte de contrôle canvas exige `percent` sur ses étendues et `degrees` sur
  sa rotation — c'est ce qui empêche un angle d'être tourné d'un facteur 57.

## Ce qui prouve que ce ticket est fini

Une règle écrite sur **ce que montre le panneau et ce que montre la toile**,
valable pour les cinq effets à contrôle spatial et pas seulement pour l'aplat.

---

## Mesure du 2026-08-18 — la question se déplace

Relevé sur le registre avant de proposer quoi que ce soit, et il change l'énoncé
du ticket.

### Le panneau parle DÉJÀ deux unités

Sur les 27 effets : **183 paramètres en `percent`, 19 en `pixels`, 42 en
`degrees`** — et **onze effets mélangent `percent` et `pixels` dans le même
panneau** : `aplat`, `dither`, `glass`, `grain`, `halftone`, `hatching`,
`isolines`, `lensBlur`, `lensDistortion`, `outlines`, `sliceShift`.

`aplat` lui-même en est : neuf paramètres en fraction, et `adoucissement` en
pixels.

**Ajouter une lecture en pixels n'introduit donc aucun mélange — il est là.** Ce
qui manque n'est pas une unité commune, c'est une **règle** qui dise lequel des
deux se montre, et quand.

### Le défaut que ce mélange produit aujourd'hui, et que personne n'avait nommé

Un adoucissement de `200 px` sur une forme de `0.4` : est-il large ou fin par
rapport à elle ? **Le panneau ne permet pas de le savoir**, les deux nombres
n'étant pas dans la même unité. Ce n'est pas la symétrie panneau/toile — c'est
une incohérence interne au panneau, et elle existe indépendamment des poignées.

### La portée est bien de cinq effets, vérifiée

`aplat`, `lensFlare`, `lightLeak`, `motionBlur`, `pixelStretch` portent des
`canvasControls`. Tous déclarent leurs étendues et positions en `percent`, leurs
rotations en `degrees`.

⚠️ **Trois d'entre eux ont des étendues qui SORTENT du cadre** — `sourceX` de
`lensFlare` va de −0,5 à 1,5, `regionX`/`regionY` de `pixelStretch` aussi. En
pixels, cela donne des valeurs négatives et des valeurs au-delà de la largeur de
la photo. C'est lisible, et Photoshop le fait, mais il faut le vouloir.

### Une quatrième voie, que le ticket n'avait pas envisagée

Le ticket posait trois issues : fraction seule, pixels, ou deux champs (refusée
par ADR-0001). Il en existe une quatrième :

> **Une seule surface, deux lectures.** Un seul champ, qui lit la fraction au
> repos et **bascule en pixels pendant qu'on tire** le curseur ou la poignée.

Elle n'est pas le cas qu'ADR-0001 refuse : il interdit **deux surfaces pour une
même valeur**, et il n'y en a qu'une. Le panneau et la toile disent alors le même
nombre au même instant, ce qui est exactement la symétrie demandée — sans coûter
une colonne sur une carte déjà étranglée à 112 px (voir le ticket 04).

### Les quatre voies, et ce que chacune coûte

| voie | ADR-0001 | Presets | répond à « quelle taille ai-je faite ? » | portée |
| --- | --- | --- | --- | --- |
| A · fraction seule | respecté | intacts | pendant le geste seulement | rien à changer |
| B · pixels | respecté | intacts (fraction toujours stockée) | oui, à tout instant | chaque champ spatial lit `imageSize` |
| C · les deux champs | **violé** | intacts | oui | +1 colonne par ligne |
| D · une surface, deux lectures | respecté | intacts | oui, pendant et juste après | une règle d'affichage partagée |

Aucune ne casse les presets : la fraction reste ce qui est stocké dans les quatre
cas. C'était la crainte du ticket, et elle ne discrimine pas.

Planche : [`docs/wireframes/unite-panneau-toile.html`](../../../docs/wireframes/unite-panneau-toile.html).
