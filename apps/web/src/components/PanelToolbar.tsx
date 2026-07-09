import type { ReactNode } from "react";

interface PanelToolbarProps {
  badge?: ReactNode;
  actions: ReactNode;
  className?: string;
}

export function PanelToolbar({ badge, actions, className = "" }: PanelToolbarProps) {
  return (
    <div className={`panel-toolbar ${className}`.trim()}>
      {badge ? <div className="panel-toolbar__badge">{badge}</div> : null}
      <div className="panel-toolbar__spacer" aria-hidden="true" />
      <div className="panel-toolbar__actions">{actions}</div>
    </div>
  );
}

export function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="btn btn--toolbar"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
