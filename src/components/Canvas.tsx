import { forwardRef } from "react";

interface Props {
  onFileDropped: (file: File) => void;
}

export const Canvas = forwardRef<HTMLCanvasElement, Props>(function Canvas({ onFileDropped }, ref) {
  return (
    <div
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFileDropped(file);
      }}
    >
      <canvas ref={ref} style={{ maxWidth: "100%", maxHeight: "100%" }} />
    </div>
  );
});
