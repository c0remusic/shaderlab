import { useRef, useState } from "react";
import type { PresetSummary } from "../presets/presetStore";
import { Button } from "./ui/button";
import "./PresetPanel.css";

export interface PresetPanelProps {
  summaries: PresetSummary[];
  hasLayers: boolean;
  // Mineur 4 (revue tâche 3) : rend `true` seulement si le preset a été
  // réellement écrit (aucune confirmation annulée par l'utilisateur, aucune
  // erreur) — le champ de saisie ne se vide que sur `true`, jamais sur la
  // seule demande d'enregistrement.
  onSave: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => void;
}

export function PresetPanel({ summaries, hasLayers, onSave, onRename }: PresetPanelProps) {
  const [nameInput, setNameInput] = useState("");
  // C2 (PRD.md:64-65), decided by Antoine 2026-07-26 (no interaction spec
  // existed in design.md — double-click-to-edit is this plan's own decision,
  // not invented UI behavior design.md described differently): double-click
  // a preset's name to replace it with a text input, pre-filled and
  // selected. Enter or blur commits (a no-op/empty name cancels instead of
  // writing); Escape cancels explicitly.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // Mineur 5 (revue tâche 3) : Échap doit annuler explicitement, pas
  // s'appuyer sur le fait que Chromium/WebView2 ne dispatche pas `blur`
  // quand l'élément focalisé est démonté — un moteur qui dispatcherait
  // `blur` au retrait ferait passer l'annulation par `onBlur={commitRename}`
  // et VALIDERAIT le renommage à la place. Ce drapeau rend l'intention
  // explicite indépendamment de ce détail de moteur.
  const cancelledRef = useRef(false);

  function startRename(summary: PresetSummary) {
    cancelledRef.current = false;
    setEditingId(summary.id);
    setEditingValue(summary.name);
  }

  function commitRename() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditingId(null);
      return;
    }
    const trimmed = editingValue.trim();
    const original = summaries.find((s) => s.id === editingId)?.name;
    if (editingId && trimmed !== "" && trimmed !== original) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="preset-panel">
      <div className="preset-panel__save-row">
        <input
          type="text"
          className="preset-panel__name-input"
          placeholder="Nom du preset"
          aria-label="Nom du nouveau preset"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          disabled={!hasLayers}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasLayers || nameInput.trim() === ""}
          onClick={async () => {
            // Mineur 4 : ne vider le champ qu'après une écriture RÉUSSIE —
            // annuler l'écrasement (ou la confirmation calque photo) laisse
            // le nom tapé intact, l'utilisateur n'a pas à le retaper.
            const written = await onSave(nameInput.trim());
            if (written) setNameInput("");
          }}
        >
          Enregistrer
        </Button>
      </div>
      {summaries.length === 0 ? (
        <p className="preset-panel__empty">Aucun preset enregistré.</p>
      ) : (
        <ul className="preset-panel__list">
          {summaries.map((summary) =>
            editingId === summary.id ? (
              <li key={summary.id} className="preset-panel__row">
                <input
                  type="text"
                  autoFocus
                  className="preset-panel__name-input"
                  aria-label="Renommer le preset"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur(); // triggers onBlur -> commitRename
                    else if (e.key === "Escape") {
                      cancelledRef.current = true;
                      setEditingId(null);
                    }
                  }}
                />
              </li>
            ) : (
              <li key={summary.id} className="preset-panel__row">
                <span className="preset-panel__row-name" onDoubleClick={() => startRename(summary)}>
                  {summary.name}
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
