interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onOpenFile: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport, onOpenFile }: Props) {
  return (
    <div
      style={{
        padding: "var(--space-2) var(--space-3)",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-default)",
        display: "flex",
        gap: "var(--space-2)",
        alignItems: "center",
        color: "var(--text-primary)",
      }}
    >
      <button onClick={onOpenFile}>Ouvrir</button>
      <button disabled={!canUndo} onClick={onUndo}>
        ↶ Annuler
      </button>
      <button disabled={!canRedo} onClick={onRedo}>
        ↷ Rétablir
      </button>
      <div style={{ flex: 1 }} />
      <button
        onClick={onExport}
        style={{
          background: "var(--accent-muted)",
          borderColor: "var(--accent)",
          color: "var(--accent)",
          fontWeight: 600,
        }}
      >
        Exporter
      </button>
    </div>
  );
}
