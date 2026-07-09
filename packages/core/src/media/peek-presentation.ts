import { PPT_EXTENSIONS, extensionOf } from "./mime.js";
import {
  extractPptxText,
  formatLegacyPptMessage,
  PRESENTATION_PREVIEW_MAX_SLIDES,
} from "./read-media.js";

/** Sample PowerPoint slide text (bundled fflate — safe for Bash via `kako peek-presentation`). */
export async function peekPresentation(
  filePath: string,
  maxSlides = PRESENTATION_PREVIEW_MAX_SLIDES,
): Promise<string> {
  const slides = Math.max(1, Math.floor(maxSlides) || PRESENTATION_PREVIEW_MAX_SLIDES);
  if (PPT_EXTENSIONS.has(extensionOf(filePath))) {
    return formatLegacyPptMessage(filePath);
  }
  return extractPptxText(filePath, { maxSlides: slides });
}

export function formatPeekPresentationBashCommand(
  filePath: string,
  maxSlides = PRESENTATION_PREVIEW_MAX_SLIDES,
): string {
  const slides = Math.max(1, Math.floor(maxSlides) || PRESENTATION_PREVIEW_MAX_SLIDES);
  return `kako peek-presentation ${JSON.stringify(filePath)} ${slides}`;
}
