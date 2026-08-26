# 16: Fresnel rampant par pixel (verre Poli)

**What to build:** En mode Poli, remplacer le Fresnel constant à 0,04 — **l'erreur
centrale** identifiée par la recherche `../retour-usage-2026-08-20/research/01-glass-shading.md`
— par une rampe de Schlick calculée par pixel : `R = 0,04 + 0,96·(1 − |view·N|)⁵`.
Le reflet s'allume aux bords et aux angles rasants, reste faible de face — c'est ce
qui « fait verre ». Fondation des tranches suivantes (le reflet fabriqué s'y module).

**Blocked by:** None (can start immediately).

**Status:** resolved — **CLOS EN CONSTAT le 2026-08-26, aucune ligne de code.**

## Le constat, mesuré

**La rampe demandée est dans l'arbre depuis le tout premier commit de `glass.ts`**
(`3c259b3`, vérifié par `git log -L 885,891`) :

- `glass.ts:889` — `let F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);` : c'est
  caractère pour caractère la formule de Schlick du ticket.
- `glass.ts:838` — `cosi = clamp(dot(N, -I), 0.0, 1.0)` avec vue orthographique
  (`I = (0,0,-1)`, `glass.ts:769`) : donc `cos θ = N.z`, par pixel, comme demandé.

**Le symptôme du ticket est réel, sa cause attribuée était fausse.** Mesuré par
port CPU des fonctions de pente (360 000 points, 6240×4160) : sur le Poli aux
défauts, l'inclinaison maximale de la normale est **2,14°**, donc `F` varie de
**1,6e-16** sur toute l'image — un verre plat vu de face réfléchit 4 %, et c'est
physiquement juste. Sur un Pavé nuage à creux 1, la même rampe déjà en place
fait courir `F` de 0,040 à 0,322 (**72 niveaux sur 255**). La rampe travaille ;
c'est la géométrie du Poli qui ne lui donne rien à ramper.

**Le vrai porteur du « voile plat » est la ligne d'à côté** : `glass.ts:890`
mélange vers une couleur FIXE `vec3(0.86, 0.89, 0.95)` — réflectance quasi
uniforme × environnement uniforme = voile uniforme. La pièce manquante est
l'ENVIRONNEMENT (Idée 3 de la recherche), pas le Fresnel (Idée 2). C'est le
ticket 17, dont le blocage sur celui-ci est levé de fait.

⚠️ **La recherche affirmait « Coller Fresnel à 0,04 PARTOUT, comme nous le
faisons »** (`01-glass-shading.md`, Idée 2) **sans avoir ouvert le shader** —
amendée le 2026-08-26. Motif « conclusion tirée du code seul », pris par l'autre
bout : une implémentation déduite d'un symptôme observé. Le symptôme (voile
plat) était vrai ; l'attribution (constante codée) ne l'était pas, et elle
aurait réorienté les tranches 17-19 dans le vide.

- [x] ~~Le Fresnel du Poli rampe avec l'angle de vue~~ — il rampait déjà, par
      pixel, depuis toujours.
- [x] ~~Le voile plat uniforme disparaît~~ — hors de portée de CETTE pièce :
      il vient de l'environnement gelé (ticket 17).
- [x] Références de pixels : **zéro** ne bouge, il n'y a rien eu à changer.
- [ ] Rien à juger — aucune image n'a changé.
