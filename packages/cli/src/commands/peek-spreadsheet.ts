import { peekSpreadsheet } from "@kako/core";

export async function runPeekSpreadsheet(filePath: string, maxRows: number): Promise<void> {
  const text = await peekSpreadsheet(filePath, maxRows);
  process.stdout.write(`${text}\n`);
}
