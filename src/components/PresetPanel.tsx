import { useState } from "react";
import type { PresetSummary } from "../presets/presetStore";
import { Button } from "./ui/button";
import "./PresetPanel.css";

export interface PresetPanelProps {
  summaries: PresetSummary[];
  hasLayers: boolean;
  onSave: (name: string) => void;
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

  function startRename(summary: PresetSummary) {
    setEditingId(summary.id);
    setEditingValue(summary.name);
  }

  function commitRename() {
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
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          disabled={!hasLayers}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasLayers || nameInput.trim() === ""}
          onClick={() => {
            onSave(nameInput.trim());
            setNameInput("");
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
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur(); // triggers onBlur -> commitRename
                    else if (e.key === "Escape") setEditingId(null);
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
