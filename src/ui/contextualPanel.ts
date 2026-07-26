import { useCallback, useState } from "react";

export type PanelOverride = "open" | "closed";

/** One remembered manual preference, valid only while `triggerKey` matches —
 *  intentionally NOT a `Map<triggerKey, override>`: switching away from a
 *  triggerKey and back does not restore an earlier override for it. */
export interface ContextualPanelState {
  key: string | null;
  override: PanelOverride | null;
}

const NO_OVERRIDE: ContextualPanelState = { key: null, override: null };

/** `visible = override === "open" || (override === null && conditionMet)` —
 *  but the override only applies when it was recorded for the SAME
 *  triggerKey currently in effect; otherwise conditionMet decides alone. */
export function computeVisible(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): boolean {
  const overrideApplies = state.override !== null && state.key === triggerKey;
  if (overrideApplies) return state.override === "open";
  return conditionMet;
}

/** Rail icon click — flips the CURRENT visible state (as computed from
 *  `state`/`conditionMet`/`triggerKey`), not the raw override field. */
export function toggleRail(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): ContextualPanelState {
  const currentlyVisible = computeVisible(state, conditionMet, triggerKey);
  return { key: triggerKey, override: currentlyVisible ? "closed" : "open" };
}

export function useContextualPanel(
  conditionMet: boolean,
  triggerKey: string | null
): { visible: boolean; toggleRail: () => void } {
  const [state, setState] = useState<ContextualPanelState>(NO_OVERRIDE);
  const visible = computeVisible(state, conditionMet, triggerKey);

  const handleToggleRail = useCallback(() => {
    setState((current) => toggleRail(current, conditionMet, triggerKey));
  }, [conditionMet, triggerKey]);

  return { visible, toggleRail: handleToggleRail };
}
