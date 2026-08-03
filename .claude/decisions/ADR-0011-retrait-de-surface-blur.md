---
id: ADR-0011
status: active
date: 2026-08-03
---

# ADR-0011 : `surfaceBlur` sort du registre

## Contexte

La famille des flous a été déclarée CLOSE le 2026-08-01 sur un découpage de
référence qui tenait techniquement : `lensBlur` intègre sur la SURFACE de
l'ouverture, `motionBlur` le long d'une TRAJECTOIRE, `surfaceBlur` est un
BILATÉRAL qui ne traverse pas les contours. Trois opérateurs, trois questions
distinctes, aucun recouvrement.

Le verdict d'usage a rouvert la question deux jours plus tard : « tous les effets
de flou sont un peu inutiles à part le motion blur ». C'est exactement le cas que
la dernière conséquence d'ADR-0010 prévoyait — *« cette décision est révisable
sur un usage réel, pas sur un argument de parité »* — mais dans l'autre sens :
non pas un flou à ajouter, un flou à retirer.

Le découpage n'est pas contesté. Ce qui est contesté, c'est qu'un opérateur
correct mérite une entrée dans une liste qu'on parcourt à chaque fois qu'on
ajoute un calque.

## Décision

**`surfaceBlur` est retiré du registre des effets.** `lensBlur` et `motionBlur`
restent (arbitrage d'Antoine, 2026-08-03).

Le retrait porte sur trois choses, et pas seulement sur l'entrée du registre :
- le module `src/render/effects/surfaceBlur.ts` et son fichier de tests ;
- le scénario `effet-surface-blur` de `scripts/render-check.mjs` et sa référence
  de pixels ;
- l'entrée correspondante de la table `ATTENDU` de `renderRefs.test.mjs`.

**Le garde d'ADR-0010 a déménagé AVANT la suppression**, vers
`test/render/effects/registry.test.ts`. Il vivait dans `surfaceBlur.test.ts` :
supprimer l'effet aurait supprimé la décision avec lui, en silence, sans qu'aucun
test ne rougisse. Une décision active n'a rien à faire dans le fichier de test
d'un effet qui peut disparaître — c'est la leçon générale de cet ADR, et elle
vaut au-delà des flous.

## Conséquences

- **Un preset qui cite `surfaceBlur` perd ce calque, il ne casse pas.**
  `presetDocument.ts` ignore un `effectId` qui ne résout plus et pousse un
  avertissement (« l'effet "surfaceBlur" n'existe plus ») ; ce n'est jamais une
  exception. Le coût du retrait est une dégradation lisible, pas une panne.
- **Le lissage sans perte de contour n'a plus d'effet dédié**, et la conséquence
  d'ADR-0010 qui s'appuyait dessus est marquée caduque. Le refus du gaussien, en
  revanche, tient : il ne reposait pas sur l'existence du bilatéral mais sur ce
  qu'un gaussien fait à une image.
- **`mireBruit` reste dans le harnais de rendu.** Elle avait été écrite pour ce
  scénario, mais elle sert aussi à `effet-outlines-bruit`, et ses deux aplats
  bruités séparés par un contour franc sont la seule mire capable de dire d'un
  opérateur local s'il préserve ce qu'il prétend préserver. Retirer l'effet ne
  retire pas l'instrument.
- **Le registre passe de vingt-trois à vingt-deux effets.** Un test le rend
  conscient : `registry.test.ts` vérifie l'absence de `surfaceBlur` et que les
  seuls effets dont l'id contient « blur » sont `lensBlur` et `motionBlur`. Le
  réintroduire demande de supprimer cette ligne, donc de relire cet ADR.

## Alternatives écartées

- **Refondre `surfaceBlur` au lieu de le retirer.** C'est le traitement retenu
  pour `lensBlur` si son verdict se confirme — onze paramètres pour un effet jugé
  inutile est un problème de prise, pas de moteur. Mais `surfaceBlur` n'a que
  trois paramètres : il n'y a pas de surface à simplifier, donc rien à refondre.
  Le problème n'était pas qu'on ne savait pas s'en servir.
- **Le garder en le dépriorisant dans la liste.** Même objection que celle
  qu'ADR-0010 oppose au gaussien documenté comme déconseillé : un effet au
  registre est un effet qu'on pose. L'ordre d'une liste n'est pas une décision.
- **Attendre un second avis d'usage.** Le premier découpage avait déjà été validé
  sur référence et non sur usage, et c'est précisément ce qui l'a fait tenir deux
  jours. Le verdict d'usage est le seul qui manquait.
