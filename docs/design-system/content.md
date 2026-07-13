# Shaderlab Design System — Content

## Language

- V1 interface language: French.
- Use sentence case: `Afficher le masque`, not `AFFICHER LE MASQUE` except
  compact visual section labels rendered uppercase by CSS.
- Use active voice and concrete verbs.
- Prefer photography vocabulary already used in the product.
- Do not call Lightroom integration a native plugin; use `éditeur externe` or
  `intégration Lightroom`.

## Labels

- Buttons begin with a verb: `Ouvrir`, `Exporter sous…`, `Remplir le masque`.
- Toggle labels describe the visible state or action unambiguously.
- Ellipsis means the action opens a dialog or needs more information.
- Avoid generic labels such as `OK`, `Apply`, `Process` or `Submit` when a
  specific verb exists.
- Units are part of the value: `48 px`, `72 %`, `0,50`.

## Tooltips

Format:

```text
Action                        Ctrl+Shortcut
Optional one-line clarification
```

- Tooltips name the action, not the icon.
- Include the shortcut when one exists.
- Keep under 120 characters unless explaining a disabled state.
- Tooltips never carry critical workflow or error content.

## Status and progress

- Use present participle for ongoing stages: `Rendu…`, `Encodage…`,
  `Écriture…`.
- Use past result for completion: `Export terminé`.
- Never show a fabricated exact percentage.
- Modified state label: `Modifiée`.
- Saved/exported state label: `Exportée` only when useful; otherwise remove the
  modified marker.

## Errors

Structure every error as:

1. **What failed:** concise title.
2. **Known reason:** plain language, no invented diagnosis.
3. **Recovery:** one or more concrete actions.
4. **Details:** optional expandable technical information.

Examples:

```text
Impossible d’ouvrir cette image
Le fichier n’est pas un JPEG valide ou il est endommagé.
[Choisir une autre image]
```

```text
Export interrompu
Shaderlab n’a pas pu écrire le fichier à l’emplacement choisi.
[Réessayer] [Choisir un autre emplacement]
```

```text
Image trop grande pour ce GPU
La limite prise en charge est de {maxWidth} × {maxHeight} px.
[Fermer]
```

- Never blame the user.
- Never expose a raw stack trace as the main message.
- Do not say `Something went wrong`.
- Do not claim a cause that is not known.

## Confirmations

Confirmation dialogs are reserved for actions that are hard to recover from.

```text
Remplacer « portrait-edited.jpg » ?
Un fichier portant ce nom existe déjà. Son contenu sera remplacé.
[Annuler] [Remplacer]
```

- Title names the consequence.
- Body explains scope.
- Safe action comes first and receives default focus.
- Destructive action repeats the precise verb, not `Oui`.
- Undoable layer and mask actions do not require modal confirmation.

## Empty states

```text
Aucune photo ouverte
Ouvrez un JPEG ou déposez-le dans l’espace de travail.
[Ouvrir…]
```

```text
Aucun calque d’effet
Ajoutez un effet pour commencer à transformer l’image.
[Ajouter un effet]
```

```text
Aucune photo modifiée
Les photos modifiées pendant cette session apparaîtront ici.
```

Empty states explain the next action and avoid marketing language.

## Accessibility content

- Accessible names describe the action: `Masquer le calque Glow`, not `Œil`.
- Slider output includes label, value and unit.
- Modified markers expose `Photo modifiée`.
- Mask overlay exposes pressed state and label.
- Decorative dividers and icons are hidden from the accessibility tree.
- File paths remain selectable/copyable where shown.

## Terminology

| Preferred | Avoid |
|---|---|
| Calque d’effet | Filtre layer |
| Mode de fusion | Fondu |
| Opacité | Transparence du filtre |
| Masque | Sélection, sauf vraie sélection |
| Pinceau / Gomme | Brush / Eraser |
| Pellicule | Galerie, pour la bande de session |
| Exporter sous… | Sauvegarder, tant qu’aucun document projet n’existe |
| Image originale | Source RAW, puisque v1 reçoit des JPEG |
