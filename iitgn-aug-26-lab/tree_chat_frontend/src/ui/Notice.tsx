// One design for every message TreeGPT shows the user (T20): icon, title, faint detail line,
// one primary action, dismiss. kind sets the colour of the left edge and the icon.
import { Icon, type IconName } from "../Icons";

export type NoticeKind = "success" | "info" | "warn" | "error";

const ICON: Record<NoticeKind, IconName> = { success: "check", info: "info", warn: "warning", error: "warning" };

type Props = {
  kind: NoticeKind;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
};

export default function Notice({ kind, title, detail, action, onDismiss }: Props) {
  return (
    <div className={`note note--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="note-icon">
        <Icon name={ICON[kind]} size={15} />
      </span>
      <div className="note-body">
        <div className="note-title">{title}</div>
        {detail ? (
          // Only a success notice's detail (the start of a question) is cut to two lines; errors,
          // warnings and info say what to do or why, so they always show in full.
          <div className={kind === "success" ? "note-detail note-detail--clamp" : "note-detail"} title={kind === "success" ? detail : undefined}>
            {detail}
          </div>
        ) : null}
      </div>
      {action ? (
        <button type="button" className="btn btn-primary btn-sm note-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" className="icon-btn icon-btn--bare" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}
