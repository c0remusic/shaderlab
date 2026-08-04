import { useEffect, useRef, useState } from "react";
import { constrainCurvePoint, evaluateMonotoneCurve, insertCurvePoint, removeCurvePoint, type CurvePoint } from "../ui/curveControl";
import "./CurveControl.css";

export interface CurveControlChannel { id: string; label: string; points: CurvePoint[] }

interface Props {
  channels: CurveControlChannel[];
  activeChannelId: string;
  disabled?: boolean;
  onActiveChannelChange: (id: string) => void;
  onChange: (channelId: string, points: CurvePoint[]) => void;
  onCommit: () => void;
}

const channelClass = (id: string) => ["master", "red", "green", "blue"].includes(id) ? id : "master";

function curvePath(points: readonly CurvePoint[]): string {
  return Array.from({ length: 65 }, (_, index) => {
    const x = index / 64;
    const y = evaluateMonotoneCurve(points, x);
    return `${index === 0 ? "M" : "L"} ${x * 100} ${(1 - y) * 100}`;
  }).join(" ");
}

export function CurveControl({ channels, activeChannelId, disabled = false, onActiveChannelChange, onChange, onCommit }: Props) {
  const graphRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ channelId: string; index: number; pointerId: number; startPoints: CurvePoint[] } | null>(null);
  const nudgingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ channelId: string; points: CurvePoint[] } | null>(null);
  const [previewChannels, setPreviewChannels] = useState(channels);
  const [selectedPoint, setSelectedPoint] = useState<{ channelId: string; index: number } | null>(null);
  const active = previewChannels.find((channel) => channel.id === activeChannelId) ?? previewChannels[0];

  useEffect(() => {
    if (!dragRef.current) setPreviewChannels(channels);
  }, [channels]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const previewChange = (channelId: string, points: CurvePoint[], immediate = false) => {
    setPreviewChannels((current) => current.map((channel) => channel.id === channelId ? { ...channel, points } : channel));
    pendingRef.current = { channelId, points };
    if (immediate) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingRef.current = null;
      onChange(channelId, points);
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) onChange(pending.channelId, pending.points);
    });
  };

  const pointFromClient = (clientX: number, clientY: number): CurvePoint | null => {
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const pointSize = Number.parseFloat(getComputedStyle(graphRef.current!).getPropertyValue("--curve-point-size")) || 0;
    const half = pointSize / 2;
    const usableWidth = Math.max(1, rect.width - pointSize);
    const usableHeight = Math.max(1, rect.height - pointSize);
    return { x: (clientX - rect.left - half) / usableWidth, y: 1 - (clientY - rect.top - half) / usableHeight };
  };

  const pointSelection = selectedPoint?.channelId === active?.id ? active.points[selectedPoint.index] : undefined;

  return <div className="curve-control" data-disabled={disabled || undefined}>
    <div className="curve-control__toolbar">
      <div className="curve-control__channels" role="tablist" aria-label="Canal de courbe">
      {previewChannels.map((channel) => <button key={channel.id} type="button" role="tab"
        aria-selected={channel.id === active?.id} disabled={disabled}
        className="curve-control__channel" data-channel={channelClass(channel.id)}
        title={channel.label} aria-label={channel.label}
        onClick={() => { onActiveChannelChange(channel.id); setSelectedPoint(null); }}>{channel.id === "master" ? "M" : channel.label.slice(0, 1)}</button>)}
      </div>
      <output className="curve-control__coordinates" aria-live="polite">
        {pointSelection ? <><span>E&nbsp;{Math.round(pointSelection.x * 100)}</span><span>S&nbsp;{Math.round(pointSelection.y * 100)}</span></> : <><span>E&nbsp;—</span><span>S&nbsp;—</span></>}
      </output>
    </div>
    <div ref={graphRef} className="curve-control__graph"
      onDoubleClick={(event) => {
        if (disabled || !active || event.target !== event.currentTarget) return;
        const point = pointFromClient(event.clientX, event.clientY);
        if (!point) return;
        const next = insertCurvePoint(active.points, point);
        if (next.length !== active.points.length) { previewChange(active.id, next, true); setSelectedPoint({ channelId: active.id, index: next.findIndex((candidate) => candidate.x === point.x && candidate.y === point.y) }); onCommit(); }
      }}>
      <svg className="curve-control__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="curve-control__diagonal" d="M 0 100 L 100 0" />
        {previewChannels.map((channel) => <path key={channel.id}
          className="curve-control__path" data-channel={channelClass(channel.id)} data-active={channel.id === active?.id || undefined}
          d={curvePath(channel.points)} />)}
      </svg>
      {active?.points.map((point, index) => <button key={`${active.id}-${index}`} type="button"
        className="curve-control__point" data-channel={channelClass(active.id)} disabled={disabled}
        data-selected={selectedPoint?.channelId === active.id && selectedPoint.index === index || undefined}
        style={{
          left: `calc(${point.x} * (100% - var(--curve-point-size)))`,
          top: `calc(${1 - point.y} * (100% - var(--curve-point-size)))`,
        }}
        aria-label={`${active.label} — point ${index + 1}, entrée ${Math.round(point.x * 100)} %, sortie ${Math.round(point.y * 100)} %`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          setSelectedPoint({ channelId: active.id, index });
          dragRef.current = { channelId: active.id, index, pointerId: event.pointerId, startPoints: active.points.map((candidate) => ({ ...candidate })) };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const nextPoint = pointFromClient(event.clientX, event.clientY);
          if (nextPoint) previewChange(active.id, constrainCurvePoint(active.points, drag.index, nextPoint));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const pending = pendingRef.current;
          if (pending) previewChange(pending.channelId, pending.points, true);
          onCommit();
        }}
        onPointerCancel={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          previewChange(drag.channelId, drag.startPoints, true);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const next = removeCurvePoint(active.points, index);
          if (next.length !== active.points.length) { previewChange(active.id, next, true); setSelectedPoint(null); onCommit(); }
        }}
        onKeyDown={(event) => {
          const amount = event.shiftKey ? 0.05 : 0.01;
          const delta = event.key === "ArrowLeft" ? { x: -amount, y: 0 }
            : event.key === "ArrowRight" ? { x: amount, y: 0 }
            : event.key === "ArrowUp" ? { x: 0, y: amount }
            : event.key === "ArrowDown" ? { x: 0, y: -amount } : null;
          if (!delta) return;
          event.preventDefault();
          nudgingRef.current = true;
          setSelectedPoint({ channelId: active.id, index });
          previewChange(active.id, constrainCurvePoint(active.points, index, { x: point.x + delta.x, y: point.y + delta.y }), true);
        }}
        onKeyUp={() => { if (nudgingRef.current) { nudgingRef.current = false; onCommit(); } }} />)}
    </div>
  </div>;
}
