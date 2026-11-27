// How much earlier conversation the model sees with the next message:
// Full · Selected · None, with a line saying exactly what will be sent.
import { Icon } from "../Icons";
import type { Preview } from "../contextView";
import type { ContextMode } from "../types";

type Props = {
  value: ContextMode;
  onChange: (mode: ContextMode) => void;
  preview: Preview;
  selectedCount: number;
  /** Opens the tree to pick messages from any branch. */
  onPickInTree?: () => void;
  onClearSelection?: () => void;
  disabled?: boolean;
};

const OPTIONS: Array<{ mode: ContextMode; label: string; title: string }> = [
  { mode: "full", label: "Full", title: "Everything earlier on this path" },
  { mode: "selected", label: "Selected", title: "Only the messages you tick, from any branch" },
  { mode: "none", label: "None", title: "Nothing earlier: only this question" },
];

export default function ContextPicker({ value, onChange, preview, selectedCount, onPickInTree, onClearSelection, disabled }: Props) {
  return (
    <div className="ctx-picker">
      <div className="seg" role="radiogroup" aria-label="Context for this message">
        <span className="seg-label">Context</span>
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={value === o.mode}
            className={value === o.mode ? "on" : ""}
            disabled={disabled}
            onClick={() => onChange(o.mode)}
            title={o.title}
          >
            {o.label}
            {o.mode === "selected" && value === "selected" ? <span className="seg-count">{selectedCount}</span> : null}
          </button>
        ))}
      </div>
      {value === "selected" ? (
        <div className="ctx-select-row">
          <span className="ctx-select-hint">
            <Icon name="checkSquare" size={13} /> Tick messages in the chat, or pick from any branch in the tree.
          </span>
          {onPickInTree ? (
            <button type="button" className="btn btn-sm" onClick={onPickInTree} disabled={disabled}>
              <Icon name="tree" size={13} /> Pick in tree
            </button>
          ) : null}
          {onClearSelection && selectedCount > 0 ? (
            <button type="button" className="btn btn-sm" onClick={onClearSelection} disabled={disabled}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`ctx-preview${preview.summarize ? " ctx-preview--sum" : preview.warn ? " ctx-preview--warn" : ""}`}>{preview.line}</div>
    </div>
  );
}
