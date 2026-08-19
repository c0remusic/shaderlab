# Le contrat `.8bf` réel — un filtre Photoshop est-il LIVE chez Affinity ?

Type: research
Status: open
Parent: ../map.md

## Pourquoi ce ticket décide de tout

Affinity 3 héberge les plugins Photoshop — établi au symbole dans
`libpersona.dll` : `.8bf`, `PIPL`, `PIMI`, `PluginMain`,
`?LoadPiPL@PhotoshopPluginFile@@`, une fonction prenant `FilterRecord@PSP@@`, et
une page de préférences complète dans `Serif.Affinity.dll` (dossiers de
recherche, dossiers détectés, statuts `Working`/`Broken`/`Unknown`).

Donc « porter nos effets dans Affinity » n'est plus un non technique. Reste UNE
question, et elle change la réponse du tout au tout :

> **Un filtre `.8bf` est-il appliqué UNE FOIS, destructivement — ou Affinity
> l'enveloppe-t-il en LIVE FILTER, non destructif et remodifiable ?**

- **Appliqué une fois** : on perd ce qui fait shaderlab — dosage après coup,
  empilement, masque par calque, presets. Nos effets deviendraient des boutons à
  sens unique. La réponse à Q1 serait alors « non », mais pour une raison de
  PRODUIT et plus du tout technique.
- **Enveloppé en live filter** : nos vingt-sept effets deviendraient des calques
  de filtre dans Affinity, avec LEURS masques et LEUR historique. Q1 devient un
  vrai arbitrage, et il n'est plus évident.

## Comment le mesurer

D'abord au symbole, sans rien installer : chercher un
`AddPluginFilterLiveFilterCommand` ou équivalent à côté des quarante-quatre
`Add*LiveFilterCommand` déjà relevés. `RasterFilterPluginWrapper` et
`PhotoshopPluginWrapper` existent — voir ce qu'ils dérivent.

Si le symbole ne tranche pas : poser un `.8bf` libre dans un dossier de plugins
et regarder ce que la pile de calques montre après application.

⚠️ **Faire valider le choix du plugin par Antoine avant de l'installer.** C'est
du code tiers exécuté dans son application, et tout le relevé jusqu'ici était en
lecture seule. Cette limite est dans les notes de la carte.

## Ce qui prouve que le ticket est fini

Une réponse binaire, sourcée — un symbole qui le dit, ou une capture de la pile
après application — et l'écriture de ce que ça implique pour Q1.

## Ce qui n'est PAS dans ce ticket

Le coût d'écriture d'un `.8bf` : C++, SDK Photoshop, et le portage de nos WGSL
sur une API que le plugin ouvrirait lui-même. Il ne se chiffre que si la réponse
ci-dessus est favorable.
