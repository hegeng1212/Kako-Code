/** Lightweight HTML → markdown for WebFetch (no DOM dependency). */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

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
    .replace(/&#39;/gi, "'");
}
