// A picker button with a popover menu (T20): used for the project and tree pickers.
// Closes on outside click and Esc; arrow keys move between items; Enter/Space select.
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../Icons";

export type DropdownItem = {
  id: string;
  label: string;
  /** Faint second line, e.g. "12 messages · 3 branches". */
  sub?: string;
  selected?: boolean;
  /** Drawn after a divider, with a leading icon (an action, not a choice). */
  action?: boolean;
  icon?: IconName;
  /** The action's icon spins (e.g. syncing). */
  busy?: boolean;
  /** Actions listed before the choices instead of after them. */
  first?: boolean;
  onSelect: () => void;
};

type Props = {
  icon: IconName;
  text: string;
  /** Shown when there is nothing selected. */
  placeholder?: string;
  title?: string;
  items: DropdownItem[];
  emptyText?: string;
  /** Open the menu aligned to the right edge (for a picker that is not in the first column). */
  alignRight?: boolean;
};

export default function Dropdown({ icon, text, placeholder, title, items, emptyText, alignRight }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        (rootRef.current?.querySelector(".dd-button") as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // focus the selected item (or the first) so the arrow keys work at once
    const els = menuRef.current?.querySelectorAll<HTMLElement>(".dd-item");
    const sel = menuRef.current?.querySelector<HTMLElement>(".dd-item.selected");
    (sel || els?.[0])?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function moveFocus(delta: number): void {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(".dd-item") ?? []);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + delta + els.length) % els.length].focus();
  }

  const choices = items.filter((i) => !i.action);
  const actions = items.filter((i) => i.action && !i.first);
  const leading = items.filter((i) => i.action && i.first);
  const actionButton = (it: DropdownItem) => (
    <button
      type="button"
      key={it.id}
      className={`dd-item dd-action${it.busy ? " spinning" : ""}`}
      onClick={() => {
        setOpen(false);
        it.onSelect();
      }}
    >
      <span className="dd-check">{it.icon ? <Icon name={it.icon} size={14} /> : null}</span>
      <span className="dd-item-text">
        <span className="dd-item-label">{it.label}</span>
        {it.sub ? <span className="dd-item-sub">{it.sub}</span> : null}
      </span>
    </button>
  );

  return (
    <div className={`dd${open ? " open" : ""}${alignRight ? " dd--wide" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="dd-button"
        title={title ?? text}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={icon} />
        <span className={`dd-text${text ? "" : " placeholder"}`}>{text || placeholder}</span>
        <Icon name="chevronDown" className="dd-chevron" />
      </button>
      {open ? (
        <div
          className="dd-menu"
          role="listbox"
          ref={menuRef}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveFocus(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {leading.map(actionButton)}
          {leading.length ? <div className="dd-divider" /> : null}
          {choices.length === 0 && emptyText ? <div className="dd-empty">{emptyText}</div> : null}
          {choices.map((it) => (
            <button
              type="button"
              key={it.id}
              role="option"
              aria-selected={!!it.selected}
              className={`dd-item${it.selected ? " selected" : ""}`}
              title={it.label}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <span className="dd-check">{it.selected ? <Icon name="check" size={14} /> : null}</span>
              <span className="dd-item-text">
                <span className="dd-item-label">{it.label}</span>
                {it.sub ? <span className="dd-item-sub">{it.sub}</span> : null}
              </span>
            </button>
          ))}
          {actions.length ? <div className="dd-divider" /> : null}
          {actions.map(actionButton)}
        </div>
      ) : null}
    </div>
  );
}
