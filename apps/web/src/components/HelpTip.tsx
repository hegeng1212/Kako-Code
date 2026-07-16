import { useId, useState, type ReactNode } from "react";

export type HelpTipContent = {
  summary: string;
  bullets?: string[];
  example?: string;
};

/** Circular ? control; shows a popover while hovered or keyboard-focused. */
export function HelpTip({ content, className = "" }: { content: HelpTipContent; className?: string }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`help-tip ${open ? "help-tip--open" : ""} ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="help-tip__btn"
        aria-label="查看说明"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        ?
      </button>
      {open && (
        <div id={tipId} className="help-tip__pop" role="tooltip">
          <p className="help-tip__summary">{content.summary}</p>
          {content.bullets && content.bullets.length > 0 && (
            <ul className="help-tip__list">
              {content.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {content.example && (
            <p className="help-tip__example">
              <span className="help-tip__example-label">示例</span>
              {content.example}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

export function TitleWithHelp({
  title,
  content,
}: {
  title: ReactNode;
  content: HelpTipContent;
}) {
  return (
    <h2 className="memory-settings__title">
      <span>{title}</span>
      <HelpTip content={content} />
    </h2>
  );
}
