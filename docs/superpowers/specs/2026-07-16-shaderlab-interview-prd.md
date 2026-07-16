# PRD — Système de calques de shaderlab

> Produit par le skill `interview` (le QUOI, usage). Nourrit
> `superpowers:brainstorming` (le COMMENT). Mode FEATURE + préambule planchers.
> Interview réelle avec Antoine, 2026-07-16.

## Contexte

shaderlab = outil desktop Windows d'effets shader GPU temps réel sur photos JPEG,
empilables en calques, faisant aussi office d'éditeur externe Lightroom. Le
système de calques actuel est fonctionnel mais pauvre : un calque est
**tout-ou-rien** (ni opacité ni mode de fusion dans le modèle `LayerState`), les
rendus sont ressentis **trop « légers »** (impossible d'aller vers l'extrême), et
l'organisation UI ne se décide pas à l'aveugle. Ce PRD cadre l'évolution du
système de calques : calques, masques, présentation.

## Objectif

Faire du système de calques un vrai outil d'édition créative : doser et fusionner
les calques comme dans un logiciel pro, masquer finement, et pousser les rendus
jusqu'à l'extrême — sans jamais dégrader la fidélité de l'empilement ni la
fluidité du geste.

## Comportements (quand X → Y)

**Calques**
- Quand j'ajuste l'opacité d'un calque → son effet s'atténue proportionnellement,
  en temps réel.
- Quand je change le mode de fusion d'un calque → il se mélange au calque
  au-dessous selon une **formule standard type Photoshop (~12+ modes)**, identique
  au logiciel de référence.
- Quand je réordonne / duplique / nomme / groupe des calques → la pile reste
  lisible et chaque action est annulable.

**Masques**
- Quand je peins un masque → **pinceau qualité Photoshop** (diamètre, dureté, flow
  réglables), fluide à 60fps.
- Quand je veux masquer sans peindre → **dégradé** linéaire/radial, ou masque par
  **luminosité / plage tonale** (masquer selon les tons de la photo).
- Quand je gère un masque → le voir (overlay), l'inverser, le désactiver, le
  copier vers un autre calque.
- Quand je réordonne un calque → son masque le suit (une seule action annulable).

**Présentation UI**
- Quand je travaille → calques, paramètres d'effet et masque sont accessibles
  ensemble. **L'organisation et le ressenti exacts se décident sur maquette
  visuelle rendue, pas verbalement** (constat d'interview : « montre-moi »).

## Hors-scope explicite

- **Refonte des effets eux-mêmes** : les plages de paramètres « extrêmes »
  ressenties trop légères = chantier EFFETS adjacent, pas le système de calques
  (noté pour un PRD séparé).
- Round-trip Lightroom (déjà cadré ailleurs).
- Workspace multi-photo / pellicule (déjà cadré).
- **Choix final de la direction visuelle du chrome** (dials VARIANCE / MOTION /
  DENSITY) → à décider sur options rendues en prototype, hors de ce PRD.

## Contraintes d'inacceptable

### Inacceptable (projet) — réutilisable par les futures features

- **Latence** : un paramètre peut mettre jusqu'à ~100 ms, mais **peindre un
  masque DOIT suivre à 60fps**. En-dessous = échec. (Deux budgets perf distincts
  selon le geste.)
- **Empilement** (les trois sont des planchers) : aucune dérive couleur/lumière
  due à l'empilement lui-même (bords sombres, halos, banding) ; opacité, masque
  et désactivation **exacts** ; **résultat identique à un logiciel de référence**
  pour un même ordre de calques. → compositing en **espace linéaire strict**.
- **Qualité** : pas de rendu « filtre Photoshop 2005 » (déjà acté, CLAUDE.md).
- **Validation** : la correction visuelle se juge **à l'œil, par checkpoint
  humain** ; jamais affirmée sans avoir été vue (constat récurrent d'interview).

### Inacceptable (feature calques)

- Perdre **silencieusement** un masque peint ou un réglage de calque = inacceptable
  (c'est du vrai travail utilisateur).

## Terminé = démontrable

- Démontrer opacité + les ~12 modes de fusion sur une **pile réelle**, comparés
  **visuellement** à un logiciel de référence (mêmes résultats).
- Démontrer un masque peint au pinceau Photoshop-grade + un masque dégradé + un
  masque luminosité, tous fluides.
- Démontrer réordonner / dupliquer / grouper + undo, le masque suivant le calque.
- Antoine valide **visuellement** chaque point dans la vraie fenêtre.

## Annexe — Choix techniques déduits (à valider au brainstorming)

Déduits de l'usage, non demandés en interview. Chacun à confirmer :

- **Modes de fusion** : implémentés en shader de compositing WebGPU/WGSL (déjà en
  place), en espace linéaire (cohérent avec la décision `rgba8unorm-srgb`).
  ⚠️ **Tension réelle à trancher** : certains modes Photoshop (overlay, soft
  light…) sont définis en espace **gamma** dans Photoshop — respecter à la fois
  « match référence » ET « linéaire strict » demande un choix explicite au
  brainstorming (formule linéaire assumée, ou conversion ciblée par mode).
- **Opacité + `blendMode`** : à ajouter au modèle `LayerState` (aujourd'hui
  absents) et à l'historique (une entrée par ajustement, borné).
- **Masques dégradé / luminosité** : nouvelles sources produisant le même
  `Uint8Array`/texture de masque que le pinceau → le pipeline masque existant est
  réutilisable.
- **Pinceau Photoshop-grade** : enrichir `MaskPainter` (flow, courbe de dureté)
  en gardant le 60fps comme plancher dur.
- **Organisation UI** : partir de l'inspecteur droit actuel (3 sections), itérer
  sur **maquette rendue** — aucune décision verbale.

---

**Prochaine étape** : PRD prêt → lancer `superpowers:brainstorming` pour concevoir
le COMMENT (en tranchant notamment la tension modes-de-fusion / espace linéaire).
