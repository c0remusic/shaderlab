import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Exclut les worktrees git imbriqués (spawn_task les crée sous
    // .claude/worktrees/ pour des sessions Claude parallèles isolées, cf.
    // CLAUDE.md) — sans ça, `npm run test` scanne aussi LEURS copies de
    // test/, gonflant silencieusement le compte de tests (constaté 2026-07-18 :
    // 19→57 fichiers dès qu'un chip spawn_task était actif).
    exclude: ["**/node_modules/**", ".claude/worktrees/**"],
  },
});
