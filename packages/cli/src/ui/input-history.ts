export const MAX_INPUT_HISTORY = 20;

export class InputHistory {
  private entries: string[] = [];
  private browseIndex = -1;
  private draft = "";

  get length(): number {
    return this.entries.length;
  }

  /** True when the user is browsing prior prompts (↑/↓). */
  isBrowsing(): boolean {
    return this.browseIndex >= 0;
  }

  /** 1-based position for the history indicator (History 11/12). */
  indicatorPosition(): number {
    return this.browseIndex + 1;
  }

  commit(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const last = this.entries[this.entries.length - 1];
    if (last === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > MAX_INPUT_HISTORY) {
      this.entries.shift();
    }
  }

  /** Replace history from session transcript (no entry cap). */
  loadEntries(entries: string[]): void {
    this.entries = [...entries];
    this.resetBrowse();
  }

  browseUp(current: string): string | null {
    if (this.entries.length === 0) return null;
    if (this.browseIndex === -1) {
      this.draft = current;
      this.browseIndex = this.entries.length - 1;
      return this.entries[this.browseIndex]!;
    }
    if (this.browseIndex === 0) return this.entries[0]!;
    this.browseIndex--;
    return this.entries[this.browseIndex]!;
  }

  browseDown(): string | null {
    if (this.browseIndex === -1) return null;
    if (this.browseIndex >= this.entries.length - 1) {
      this.browseIndex = -1;
      return this.draft;
    }
    this.browseIndex++;
    return this.entries[this.browseIndex]!;
  }

  resetBrowse(): void {
    this.browseIndex = -1;
    this.draft = "";
  }
}
