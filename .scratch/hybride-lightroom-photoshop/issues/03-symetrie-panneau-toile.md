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
