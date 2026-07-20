import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("design system contract", () => {
  it("exposes the required token layers", () => {
    const primitives = read("src/design/primitives.css");
    const semantics = read("src/design/semantic.css");
    const components = read("src/design/components.css");

    expect(primitives).toContain("--primitive-neutral-950");
    expect(semantics).toContain("--surface-workspace");
    expect(semantics).toContain("--focus-color");
    expect(components).toContain("--control-height-sm");
    expect(components).toContain("--inspector-width-default");
  });

  it("does not restore the legacy blue accent", () => {
    const css = [
      read("src/design/primitives.css"),
      read("src/design/semantic.css"),
      read("src/design/components.css"),
    ].join("\n");
    expect(css.toLowerCase()).not.toContain("#5aa9e6");
  });

  it("keeps the primary button on a neutral paper fill, never a brand color", () => {
    // docs/design-system/tokens.md §Actions and statuses ; src/ui/actions.css
    // documents this explicitly ("Primary: neutral paper fill, never a
    // brand color"). Régression réelle le 2026-07-20 : le thème Photoshop
    // avait remappé action-primary-bg vers l'accent bleu (#4069fd) sans que
    // ce test ne l'attrape (il ne vérifiait que l'absence de l'ancien hex
    // #5aa9e6, pas le mapping réel).
    const semantics = read("src/design/semantic.css");
    expect(semantics).toContain("--action-primary-bg: var(--primitive-neutral-200);");
    expect(semantics).toContain("--action-primary-text: var(--text-on-light);");
    expect(semantics).toContain("--action-primary-hover: var(--primitive-neutral-100);");
  });
});
