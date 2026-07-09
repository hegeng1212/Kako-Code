/** Lightweight HTML → markdown for WebFetch (no DOM dependency). */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  text = removeBoilerplateBlocks(text);
  text = extractMainContent(text);

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, body) => `\n# ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, body) => `\n## ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, body) => `\n### ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, body) => `\n#### ${stripTags(body).trim()}\n\n`);
  text = text.replace(
    /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, label) => `[${stripTags(label).trim()}](${href})`,
  );
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${stripTags(body).trim()}`);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = stripTags(text);
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

const BOILERPLATE_BLOCK =
  /<(nav|footer|header|aside|svg|iframe|form|menu|figure)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Remove structural chrome blocks before markdown conversion. */
export function removeBoilerplateBlocks(html: string): string {
  let text = html;
  let prev = "";
  while (text !== prev) {
    prev = text;
    text = text.replace(BOILERPLATE_BLOCK, "");
  }
  return text;
}

/** Prefer article/main landmarks when they contain substantial text. */
export function extractMainContent(html: string): string {
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<div\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/div>/gi,
  ];

  let best = "";
  let bestLen = 0;
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const block = match[1] ?? "";
      const len = visibleTextLength(block);
      if (len > bestLen) {
        bestLen = len;
        best = block;
      }
    }
  }

  if (bestLen >= 200) return best;

  const totalLen = visibleTextLength(html);
  if (bestLen >= 80 && totalLen > 0 && bestLen / totalLen >= 0.4) return best;

  return html;
}

function visibleTextLength(html: string): number {
  return stripTags(html).replace(/\s+/g, " ").trim().length;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
