# Le seul gate de shader qui tourne en CI est rouge

Type: task
Status: ready-for-agent
Parent: ../map.md

## Question

`test/render/wgslNaga.test.ts` (arrivé avec `677a39d`, poussé dans `af075ce`)
**échoue**, et il est le SEUL gate de shader qui tourne en CI — les deux autres
(`test:gpu-shaders`, `test:render`) exigent un GPU et sont donc locaux.

Tant qu'il est rouge, la CI l'est aussi, et **un vrai défaut de WGSL y passerait
inaperçu au milieu du bruit**. C'est le pire état pour un gate : présent, donc
on croit être couvert ; rouge en permanence, donc plus personne ne le lit.

## Ce qui est déjà su, et qui rend le ticket court

La cause est unique, connue, et `CLAUDE.md` la documente en toutes lettres avant
même que le test existe :

> notre uniform `params: array<f32, 48>` n'est pas conforme (stride 4 pour un
> alignement requis de 16 en espace uniform), Dawn l'accepte quand même, et
> corriger toucherait chaque accès `params[N]` des 23 effets — index gelés par
> les presets.

Le message de naga le confirme, identique sur **tous** les effets du registre :

```
error: Global variable [2] 'params' is invalid
   ┌─ glow_composite.wgsl:22:23
22 │ @group(0) @binding(2) var<uniform> params: array<f32, 48>;
```

Ce n'est donc pas une régression de rendu : c'est le gate qui n'a pas encore sa
dérogation.

## Ce qu'il reste à décider, et c'est la seule vraie question

**Comment porter la dérogation sans la rendre aveugle.** Trois formes possibles,
et elles ne se valent pas :

1. **Filtrer ce message précis** (`Global variable [2] 'params' is invalid`) :
   simple, mais il masquerait aussi un futur défaut sur ce même uniform.
2. **Filtrer par NOM de variable** (`params`) : plus étroit, mais tout aussi
   muet si un jour `params` devient réellement invalide pour une autre raison.
3. **Rendre l'uniform conforme** — `array<vec4<f32>, 12>` au lieu de
   `array<f32, 48>`, avec un accesseur qui recompose l'index. Le WGSL redevient
   conforme, mais **chaque accès `params[N]` des 23 effets change**, et les
   index sont gelés par les presets ET par 97 références de pixels. C'est un
   chantier, pas une correction.

⚠️ Quelle que soit la forme retenue, la dérogation doit être **bornée et
comptée** : un test qui filtre doit dire combien d'erreurs il a filtrées et
échouer si ce nombre change. Sinon la prochaine erreur entrera dans le filtre
sans que personne ne le voie — exactement le défaut que ce ticket décrit.

## Partie AFK

1. Lire le test et voir s'il prévoit déjà un mécanisme d'exclusion inutilisé.
2. Compter les occurrences : combien de shaders composés, combien d'erreurs par
   shader, et si `params` est la seule cause (le message est le même partout,
   mais rien ne prouve encore qu'il n'y en a pas d'autres derrière).
3. Vérifier ce que la CI fait de ce rouge aujourd'hui — bloque-t-elle, ou
   est-elle déjà rouge depuis assez longtemps pour qu'on ne la regarde plus ?

## Ce qui rendrait ce ticket raté

Neutraliser le test pour retrouver du vert. Il a été écrit parce qu'aucun gate
de shader ne tournait en CI ; le rendre silencieux le ramènerait à zéro tout en
laissant croire le contraire.
