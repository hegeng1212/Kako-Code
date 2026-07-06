export const IMAGE_MARKER_PATTERN = /\[Image #(\d+)\]/g;

export function formatImageMarker(index: number): string {
  return `[Image #${index}]`;
}

/** Image labels in the order they appear in the user message. */
export function extractImageLabelsInOrder(text: string): string[] {
  const labels: string[] = [];
  for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
    labels.push(formatImageMarker(Number(match[1])));
  }
  return labels;
}

export function nextImageIndexFromText(text: string): number {
  let max = 0;
  for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
