export const MAX_INPUT_HISTORY = 20;

/**
 * Keep transcript-backed prompts while preserving local-only entries (e.g. /workflows)
 * that never appear in the session transcript.
 */
export function mergeInputHistory(localEntries: string[], transcriptEntries: string[]): string[] {
  const transcriptSet = new Set(transcriptEntries);
  const pending = [...transcriptEntries];
  const merged: string[] = [];

  const push = (entry: string): void => {
    if (merged[merged.length - 1] === entry) return;
    merged.push(entry);
  };

  for (const entry of localEntries) {
    if (!transcriptSet.has(entry)) {
      push(entry);
      continue;
    }
    const idx = pending.indexOf(entry);
    if (idx < 0) continue;
    pending.splice(0, idx + 1);
    push(entry);
  }

  for (const entry of pending) {
    push(entry);
  }

  return merged;
}

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

  /** Merge transcript prompts into local history without dropping local-only entries. */
  mergeFromTranscript(transcriptEntries: string[]): void {
    this.entries = mergeInputHistory(this.entries, transcriptEntries);
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
