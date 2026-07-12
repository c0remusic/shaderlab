interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport }: Props) {
  return (
    <div style={{ padding: 8, borderBottom: "1px solid #333", display: "flex", gap: 8 }}>
      <button disabled={!canUndo} onClick={onUndo}>
        ↶ Annuler
      </button>
      <button disabled={!canRedo} onClick={onRedo}>
        ↷ Rétablir
      </button>
      <div style={{ flex: 1 }} />
      <button onClick={onExport}>Exporter</button>
    </div>
  );
}
