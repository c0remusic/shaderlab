import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { nextEnabledIndex, type SelectOption } from "./selectNavigation";
import { computeListboxPlacement, type ListboxPlacement } from "./selectPlacement";

export type { SelectOption };

export interface SelectProps {
  label: string;
  value: string | null;
  placeholder?: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

/** max-height de .ui-select__listbox (src/ui/overlays.css) — dupliqué ici
 *  pour le calcul de retournement viewport ; pas de lecture CSS->JS possible
 *  avant montage (le portail n'existe pas encore au moment du calcul). */
const LISTBOX_MAX_HEIGHT = 240;

/**
 * Custom button + listbox select (not a native <select>). La listbox est
 * portalée dans document.body (position: fixed, ancrée sur le rect du
 * trigger) — pas un enfant en position: absolute du conteneur. Un FloatingPanel
 * a un contenu scrollable (overflow-y: auto, cf. FloatingPanel.css) : un
 * enfant absolu y serait clippé au bord du scroll (finding auditor HAUTE,
 * 2026-07-20 — le premier fix "overflow: visible sur l'ancêtre" ne
 * fonctionne plus dès que cet ancêtre doit aussi scroller son contenu).
 */
export function Select({ label, value, placeholder = "Sélectionner…", options, onChange }: SelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [listboxRect, setListboxRect] = useState<ListboxPlacement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef({ query: "", timeoutId: undefined as number | undefined });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Le focus ne peut être posé qu'APRÈS que le portail a réellement monté la
  // listbox dans le DOM — càd après que `listboxRect` (effet suivant) a été
  // calculé et a déclenché le re-render qui la crée. Un seul effet sur
  // `[open]` ciblait encore `listRef.current` = null à la première ouverture
  // (finding codex-crosscheck HAUTE).
  useEffect(() => {
    if (!open || !listboxRect) return;
    listRef.current?.focus();
  }, [open, listboxRect]);

  // Position fixe recalculée à l'ouverture + à chaque scroll (capture: true
  // pour intercepter le scroll d'un ancêtre imbriqué, ex. FloatingPanel__content)
  // et resize — pas de suivi continu pendant le scroll, la liste se referme
  // plutôt que de traîner derrière une position périmée (comportement standard
  // des popups non ancrés en layout, ex. menus natifs).
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // --space-2 lu sur :root (existe indépendamment du montage du portail) —
    // source unique avec le token CSS plutôt qu'une valeur dupliquée en dur.
    const gapPx =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 4;
    setListboxRect(
      computeListboxPlacement(
        { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
        window.innerHeight,
        gapPx,
        LISTBOX_MAX_HEIGHT
      )
    );

    function closeOnScrollOrResize() {
      setOpen(false);
    }
    window.addEventListener("scroll", closeOnScrollOrResize, { capture: true });
    window.addEventListener("resize", closeOnScrollOrResize);
    return () => {
      window.removeEventListener("scroll", closeOnScrollOrResize, { capture: true });
      window.removeEventListener("resize", closeOnScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(options, -1, 1));
    setOpen(true);
  }

  function closeList(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeList(true);
  }

  const TYPEAHEAD_RESET_MS = 500;

  /**
   * Single-character typeahead: each keypress searches forward from just
   * after `anchorIndex` for the next enabled option whose label starts with
   * that character, wrapping at the end — so repeating the same letter
   * cycles through every match (classic native <select> behavior). No
   * multi-char accumulation: the reset timer only bounds how long a stale
   * query buffer could linger, it is not read for matching.
   */
  function typeaheadMatch(char: string, anchorIndex: number): number {
    const state = typeaheadRef.current;
    window.clearTimeout(state.timeoutId);
    state.query = char.toLowerCase();
    state.timeoutId = window.setTimeout(() => {
      typeaheadRef.current.query = "";
    }, TYPEAHEAD_RESET_MS);

    const count = options.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (((anchorIndex + step) % count) + count) % count;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(state.query)) {
        return index;
      }
    }
    return -1;
  }

  function isPrintableKey(key: string): boolean {
    return key.length === 1 && key !== " ";
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        event.preventDefault();
        openList();
        break;
      default:
        if (isPrintableKey(event.key)) {
          const match = typeaheadMatch(event.key, selectedIndex);
          if (match >= 0) onChange(options[match].value);
        }
        break;
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(options, current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(options, current, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(options, -1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(options, options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        closeList(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (isPrintableKey(event.key)) {
          event.preventDefault();
          const match = typeaheadMatch(event.key, activeIndex);
          if (match >= 0) setActiveIndex(match);
        }
        break;
    }
  }

  return (
    <div className="ui-select" ref={rootRef}>
      <span className="ui-select__label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${labelId} ${id}`}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`ui-select__value ${selectedOption ? "" : "ui-select__value--placeholder"}`.trim()}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="ui-select__chevron" size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open &&
        listboxRect &&
        createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
            className="ui-select__listbox"
            style={{
              left: listboxRect.left,
              width: listboxRect.width,
              maxHeight: listboxRect.maxHeight,
              ...(listboxRect.top !== undefined ? { top: listboxRect.top } : { bottom: listboxRect.bottom }),
            }}
            tabIndex={-1}
            onKeyDown={handleListKeyDown}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  className={[
                    "ui-select__option",
                    active && "ui-select__option--active",
                    option.disabled && "ui-select__option--disabled",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span className="ui-select__option-label">{option.label}</span>
                  {selected && (
                    <Check className="ui-select__option-check" size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}
