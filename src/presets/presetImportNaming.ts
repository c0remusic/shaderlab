/** Yields "<name> (copie)", "<name> (copie 2)", "<name> (copie 3)", ...
 *  indefinitely — same shape as `candidateCopyPaths` in
 *  `src/export/exportImage.ts` (the project's existing "-edited"/"-edited-N"
 *  generator), reused as the pattern rather than reinvented. */
function* candidateImportNames(name: string): Generator<string> {
  yield `${name} (copie)`;
  let counter = 2;
  while (true) {
    yield `${name} (copie ${counter})`;
    counter += 1;
  }
}

/** Decided by Antoine 2026-07-26 (design.md §9, P3): an import colliding on
 *  `name` with an existing preset is renamed to the first free
 *  "<name> (copie[ N])" suffix — never silently duplicated, never blocked.
 *  Pure function of `existingNames`/`incomingName`; `presetStore.importFrom`
 *  is the only caller, supplying `list().map(s => s.name)`. */
export function resolveImportName(existingNames: string[], incomingName: string): string {
  if (!existingNames.includes(incomingName)) return incomingName;
  const taken = new Set(existingNames);
  for (const candidate of candidateImportNames(incomingName)) {
    if (!taken.has(candidate)) return candidate;
  }
  /* istanbul ignore next -- candidateImportNames never terminates on its
   * own; TS control-flow analysis can't prove that, so this satisfies the
   * "string" return type without ever actually running. */
  throw new Error("unreachable");
}
