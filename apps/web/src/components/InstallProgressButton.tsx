import { useEffect, useState } from "react";

interface InstallProgressButtonProps {
  label?: string;
  installingLabel?: string;
  installing: boolean;
  disabled?: boolean;
  variant?: "secondary" | "primary";
  onClick: () => void;
}

export function InstallProgressButton({
  label = "安装",
  installingLabel = "安装中…",
  installing,
  disabled = false,
  variant = "secondary",
  onClick,
}: InstallProgressButtonProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!installing) {
      setProgress(0);
      return;
    }
    setProgress(6);
    const start = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress((prev) => Math.max(prev, Math.min(92, 6 + elapsed / 22)));
    }, 40);
    return () => window.clearInterval(timer);
  }, [installing]);

  return (
    <button
      type="button"
      className={`btn btn--install btn--install--${variant}${installing ? " btn--install--busy" : ""}`}
      disabled={disabled || installing}
      onClick={onClick}
    >
      <span
        className="btn--install__fill"
        style={{ width: installing ? `${progress}%` : "0%" }}
      />
      <span className="btn--install__label">{installing ? installingLabel : label}</span>
    </button>
  );
}
