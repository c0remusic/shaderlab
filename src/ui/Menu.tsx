import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface MenuItem {
  value: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface MenuProps {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  variant?: "primary" | "secondary";
}

function nextEnabledIndex(items: MenuItem[], from: number, direction: 1 | -1): number {
  const count = items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + step * direction) % count) + count) % count;
    if (!items[index].disabled) return index;
  }
  return from;
}

/**
 * Button + menu popover (role="menu"/"menuitem") for grouping actions, not
 * values — for value selection use Select. No portal, same convention as
 * Select: the containing element must allow overflow.
 */
export function Menu({ label, icon, items, variant = "secondary" }: MenuProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openMenu() {
    setActiveIndex(nextEnabledIndex(items, -1, 1));
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    closeMenu(true);
    item.onSelect();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        event.preventDefault();
        openMenu();
        break;
      default:
        break;
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(items, current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(items, current, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="ui-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`ui-button ui-button--${variant} ui-button--default ui-menu__trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="ui-button__content">
          {icon}
          {label}
        </span>
        <ChevronDown className="ui-menu__chevron" size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={id}
          className="ui-menu__list"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={item.value}
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                className={[
                  "ui-menu__item",
                  active && "ui-menu__item--active",
                  item.disabled && "ui-menu__item--disabled",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => !item.disabled && setActiveIndex(index)}
                onClick={() => commit(index)}
              >
                {item.icon}
                <span className="ui-menu__item-label">{item.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
