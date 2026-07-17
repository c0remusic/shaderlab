import { describe, it, expect } from "vitest";

// App.tsx est un composant React monté via Tauri/WebView — pas de rendu de
// composant dans ce projet (convention CLAUDE.md), donc pas de test direct
// ici. Sa seule logique non triviale (resync du painter de masque après
// undo/redo pendant une session de peinture) a été extraite en fonction
// pure testable : voir test/mask/maskPainterSync.test.ts (audit 2026-07-17,
// finding 3). Le reste de App.tsx est de l'orchestration UI/état, vérifiée
// visuellement par convention projet (CDP sur la fenêtre réelle), pas par
// des tests unitaires.
describe("scaffold sanity check", () => {
  it("basic arithmetic works", () => {
    expect(1 + 1).toBe(2);
  });
});
