import { peekPresentation } from "@kako/core";

export async function runPeekPresentation(filePath: string, maxSlides: number): Promise<void> {
  const text = await peekPresentation(filePath, maxSlides);
  process.stdout.write(`${text}\n`);
}
