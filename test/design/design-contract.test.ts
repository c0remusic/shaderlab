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
});
