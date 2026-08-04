import { Pipette, X } from "lucide-react";
import { LabeledSlider } from "./ui/labeled-slider";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import "./ColorRangeControl.css";

interface Props { samples: number[]; tolerance: number; hardness: number; disabled?: boolean; onAddSample: () => void; onChange: (patch: Record<string, number | number[]>) => void; onCommit: () => void }

function sampleHex(color: number[]): string {
  return `#${color.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function ColorRangeControl({ samples, tolerance, hardness, disabled = false, onAddSample, onChange, onCommit }: Props) {
  const colors = Array.from({ length: Math.floor(samples.length / 3) }, (_, index) => samples.slice(index * 3, index * 3 + 3));
  return <section className="color-range" aria-label="Plage couleur">
    <div className="color-range__samples">
      {colors.length === 0 ? <p>Aucun échantillon.</p> : colors.map((color, index) => (
        <div key={`${index}:${color.join(":")}`} className="color-range__sample">
          <span className="color-range__swatch" style={{ backgroundColor: sampleHex(color) }} aria-label={`Échantillon ${index + 1}`} role="img" />
          <IconButton label={`Supprimer l’échantillon ${index + 1}`} tooltip="Supprimer" size="compact" disabled={disabled} onClick={() => { onChange({ samples: samples.filter((_, valueIndex) => Math.floor(valueIndex / 3) !== index) }); onCommit(); }}><X className="icon-sm icon-stroke" aria-hidden="true" /></IconButton>
        </div>
      ))}
    </div>
    <Button variant="secondary" disabled={disabled} onClick={onAddSample}><Pipette className="icon-sm icon-stroke" aria-hidden="true" /> Prélever au centre</Button>
    <LabeledSlider label="Tolérance" value={tolerance} min={0} max={1} step={0.01} disabled={disabled} onChange={(value) => onChange({ tolerance: value })} onCommit={onCommit} />
    <LabeledSlider label="Dureté" value={hardness} min={0} max={1} step={0.01} disabled={disabled} onChange={(value) => onChange({ hardness: value })} onCommit={onCommit} />
  </section>;
}
