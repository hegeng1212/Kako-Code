/** Terminal background detection and ANSI palette switching. */

export type TerminalTheme = "light" | "dark";

export interface ThemePalette {
  text: string;
  muted: string;
  placeholder: string;
  inputBorder: string;
  line: string;
  tableBorder: string;
  accent: string;
  accentBold: string;
  userMessageBg: string;
  codeBg: string;
  selectionBg: string;
}

const DARK_PALETTE: ThemePalette = {
  text: "\x1b[38;5;255m",
  muted: "\x1b[38;5;245m",
  placeholder: "\x1b[38;5;243m",
  inputBorder: "\x1b[38;5;255m",
  line: "\x1b[38;5;238m",
  tableBorder: "\x1b[38;5;255m",
  accent: "\x1b[38;5;210m",
  accentBold: "\x1b[1;38;5;210m",
  userMessageBg: "\x1b[48;5;235m",
  codeBg: "\x1b[48;5;236m",
  selectionBg: "\x1b[48;5;67m",
};

const LIGHT_PALETTE: ThemePalette = {
  text: "\x1b[38;5;237m",
  muted: "\x1b[38;5;239m",
  placeholder: "\x1b[38;5;240m",
  inputBorder: "\x1b[38;5;238m",
  line: "\x1b[38;5;244m",
  tableBorder: "\x1b[38;5;238m",
  accent: "\x1b[38;5;167m",
  accentBold: "\x1b[1;38;5;167m",
  userMessageBg: "\x1b[48;5;254m",
  codeBg: "\x1b[48;5;253m",
  selectionBg: "\x1b[48;5;153m",
};

let activeTheme: TerminalTheme = "dark";

export function detectTerminalTheme(): TerminalTheme {
  const override = process.env.KAKO_THEME?.trim().toLowerCase();
  if (override === "light" || override === "dark") return override;

  const colorfgbg = process.env.COLORFGBG?.trim();
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (!Number.isNaN(bg)) {
      if (bg === 7 || bg === 15 || bg >= 252) return "light";
      if (bg === 0 || bg === 8 || (bg >= 1 && bg <= 6)) return "dark";
    }
  }

  return "dark";
}

export function getTerminalTheme(): TerminalTheme {
  return activeTheme;
}

export function paletteForTheme(theme: TerminalTheme): ThemePalette {
  return theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

export function applyThemePalette(target: ThemePalette & Record<string, string>, theme: TerminalTheme): void {
  Object.assign(target, paletteForTheme(theme));
  activeTheme = theme;
}
