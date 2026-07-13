# shaderlab — système de design

Établi le 2026-07-13, direction "directe et concrète" calée sur Dehancer
Desktop / Nik Collection (outil pro sombre, pas l'exercice créatif complet
de la skill interface-design — l'utilisateur a explicitement demandé de
zapper l'exploration de domaine et d'aller droit à des tokens concrets).

## Tokens (src/index.css)

- **Surfaces** : `--bg-base` (#161616, canvas) → `--bg-surface` (#1e1e1e,
  panneaux) → `--bg-elevated` (#262626, hover/dropdown) — un cran discret à
  chaque niveau, jamais de saut brutal. `--bg-input` (#121212) pour les
  champs, plus sombre = "inset".
- **Bordures** : progression par opacité, jamais de gris plein —
  `--border-subtle` (0.06) → `--border-default` (0.12) → `--border-emphasis`
  (0.22) → `--border-focus` (= accent).
- **Texte** : 4 niveaux — `--text-primary` (0.92), `--text-secondary`
  (0.65), `--text-tertiary` (0.45), `--text-muted` (0.3).
- **Accent unique** : `--accent` bleu-acier `#5aa9e6`, `--accent-muted`
  (0.15 opacité pour les fonds d'état actif) — réservé aux états
  actifs/sélectionnés (calque sélectionné, bouton Exporter, mode peinture
  masque actif). Pas d'autre couleur d'accent.
- **Espacement** : base 4px, échelle `--space-1` à `--space-6` (4/8/12/16/24).
- **Rayon** : `--radius-sm` (3px, inputs/boutons), `--radius-md` (5px,
  panneaux) — sobre et technique, pas arrondi façon app grand public.
- **Profondeur** : bordures uniquement, JAMAIS d'ombre — outil technique
  dense, pas une carte SaaS.
- **Chiffres** : classe `.value-readout` (`font-variant-numeric:
  tabular-nums`) pour les valeurs de sliders — alignement façon instrument
  de mesure.

## Patterns de composants

- Calque sélectionné : fond `--accent-muted` + liseré gauche 2px
  `--accent`.
- Bouton d'action primaire (Exporter) : fond `--accent-muted`, bordure et
  texte `--accent`, `font-weight: 600`.
- Titres de section (ex. "MASQUE") : `0.75em`, `font-weight: 600`,
  `letter-spacing: 0.06em`, `text-transform: uppercase`, couleur
  `--text-tertiary`.
- Labels de slider : ligne `justify-content: space-between` (label à
  gauche, valeur tabulaire à droite).

## Non fait (hors scope de cette passe)

- Pas d'exploration de domaine/signature créative (skill interface-design
  zappée sur demande explicite).
- Pas de masque de survol visualisable (overlay rouge semi-transparent)
  côté UI — noté ailleurs comme backlog.
- Pas de dark/light toggle — un seul thème sombre assumé (voir CLAUDE.md,
  fix du bug de contraste `prefers-color-scheme`).
