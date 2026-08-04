import { useRef } from "react";
import { clampTonalHandle, effectTonalCurvePath, tonalCurvePath, type TonalRangeValues } from "../ui/tonalRange";
import { LabeledSlider } from "./ui/labeled-slider";
import "./TonalRangeControl.css";

interface Props { values: TonalRangeValues; kind?: "mask" | "effect"; disabled?: boolean; onChange: (patch: Partial<TonalRangeValues>) => void; onCommit: () => void }

export function TonalRangeControl({ values, kind = "mask", disabled = false, onChange, onCommit }: Props) {
  const dragging = useRef<keyof TonalRangeValues | null>(null);
  const setHandle = (key: keyof TonalRangeValues, raw: number) => {
    onChange({ [key]: clampTonalHandle(values, key, raw) });
  };
  const handles = [
    ["shadowsMin", "Début des ombres"], ["shadowsMax", "Fin des ombres"],
    ["highlightsMin", "Début des hautes lumières"], ["highlightsMax", "Fin des hautes lumières"],
  ] as const;
  return <section className="tonal-range" data-kind={kind} aria-label="Plage tonale">
    <div className="tonal-range__graph">
      <div className="tonal-range__gradient" aria-hidden="true" />
      <svg viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true"><path d={(kind === "effect" ? effectTonalCurvePath : tonalCurvePath)(values, 240, 64)} /></svg>
      {handles.map(([key, label]) => <button key={key} type="button" className="tonal-range__handle"
        data-role={key} data-edge={values[key] === 0 ? "start" : values[key] === 1 ? "end" : undefined}
        style={{ left: `${values[key] * 100}%` }} aria-label={`${label} — ${Math.round(values[key] * 100)} %`} title={`${label} · ${Math.round(values[key] * 100)} %`} disabled={disabled}
        onPointerDown={(event) => { if (event.button !== 0) return; dragging.current = key; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (dragging.current !== key) return; const rect = event.currentTarget.parentElement!.getBoundingClientRect(); setHandle(key, (event.clientX - rect.left) / rect.width); }}
        onPointerUp={(event) => { if (dragging.current !== key) return; dragging.current = null; event.currentTarget.releasePointerCapture(event.pointerId); onCommit(); }}
        onPointerCancel={() => { dragging.current = null; }}
        onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); setHandle(key, values[key] + (event.key === "ArrowLeft" ? -0.01 : 0.01)); }}
        onKeyUp={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") onCommit(); }} />)}
    </div>
    {kind === "effect" && <div className="tonal-range__values" aria-hidden="true">
      {handles.map(([key]) => <span key={key}>{Math.round(values[key] * 100)}</span>)}
    </div>}
    {kind === "mask" && <>
    <div className="tonal-range__pair"><span>Ombres</span>
      <LabeledSlider label="Début des ombres" value={values.shadowsMin} min={0} max={values.shadowsMax} step={0.01} disabled={disabled} onChange={(shadowsMin) => onChange({ shadowsMin })} onCommit={onCommit} />
      <LabeledSlider label="Fin des ombres" value={values.shadowsMax} min={values.shadowsMin} max={values.highlightsMin} step={0.01} disabled={disabled} onChange={(shadowsMax) => onChange({ shadowsMax })} onCommit={onCommit} />
    </div>
    <div className="tonal-range__pair"><span>Hautes lumières</span>
      <LabeledSlider label="Début des hautes lumières" value={values.highlightsMin} min={values.shadowsMax} max={values.highlightsMax} step={0.01} disabled={disabled} onChange={(highlightsMin) => onChange({ highlightsMin })} onCommit={onCommit} />
      <LabeledSlider label="Fin des hautes lumières" value={values.highlightsMax} min={values.highlightsMin} max={1} step={0.01} disabled={disabled} onChange={(highlightsMax) => onChange({ highlightsMax })} onCommit={onCommit} />
    </div>
    </>}
  </section>;
}
