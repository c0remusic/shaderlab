import type { CSSProperties } from "react";
import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (v: number) => void;
  erase: boolean;
  onEraseChange: (v: boolean) => void;
}

const panelStyle: CSSProperties = {
  width: 260,
  background: "var(--bg-surface)",
  borderLeft: "1px solid var(--border-default)",
  padding: "var(--space-3)",
  color: "var(--text-primary)",
};

const sectionHeading: CSSProperties = {
  fontSize: "0.75em",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  margin: "0 0 var(--space-2) 0",
};

const rowStyle: CSSProperties = { marginBottom: "var(--space-3)" };

const labelStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "0.85em",
  color: "var(--text-secondary)",
  marginBottom: "var(--space-1)",
};

export function ParamPanel({
  layer,
  onParamChange,
  maskPaintMode,
  onToggleMaskPaint,
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  erase,
  onEraseChange,
}: Props) {
  if (!layer) {
    return <div style={{ ...panelStyle, color: "var(--text-tertiary)" }}>Sélectionne un calque.</div>;
  }
  const effect = getEffect(layer.effectId);

  return (
    <div style={panelStyle}>
      <h3 style={{ ...sectionHeading, fontSize: "0.8em", color: "var(--text-primary)" }}>{effect.name}</h3>
      {effect.params.map((p) => (
        <div key={p.name} style={rowStyle}>
          <label style={labelStyle}>
            <span>{p.name}</span>
            <span className="value-readout">{(layer.params[p.name] ?? p.default).toFixed(3)}</span>
          </label>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={layer.params[p.name] ?? p.default}
            onChange={(e) => onParamChange(layer.id, { [p.name]: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
      ))}
      <hr style={{ margin: "var(--space-4) 0", border: "none", borderTop: "1px solid var(--border-subtle)" }} />
      <h4 style={sectionHeading}>Masque</h4>
      <button
        onClick={onToggleMaskPaint}
        style={{
          width: "100%",
          marginBottom: "var(--space-3)",
          background: maskPaintMode ? "var(--accent-muted)" : "var(--bg-elevated)",
          borderColor: maskPaintMode ? "var(--accent)" : "var(--border-default)",
          color: maskPaintMode ? "var(--accent)" : "var(--text-primary)",
        }}
      >
        {maskPaintMode ? "Arrêter de peindre" : "Peindre le masque"}
      </button>
      <div style={rowStyle}>
        <label style={labelStyle}>
          <span>Taille</span>
          <span className="value-readout">{brushSize}</span>
        </label>
        <input
          type="range"
          min={2}
          max={200}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>
          <span>Dureté</span>
          <span className="value-readout">{brushHardness.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={brushHardness}
          onChange={(e) => onBrushHardnessChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--text-secondary)", fontSize: "0.85em" }}>
        <input type="checkbox" checked={erase} onChange={(e) => onEraseChange(e.target.checked)} />
        Gomme
      </label>
    </div>
  );
}
