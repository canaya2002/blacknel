import 'server-only';

import { textBlockConfigSchema } from '../validate';
import type { TextBlockPayload } from '../types';

/**
 * Phase 10 / Commit 39 — Text block widget renderer.
 *
 * Markdown → sanitized HTML. The sanitizer is intentionally narrow —
 * supports the small set of inline+block elements a report comment
 * would reasonably need:
 *
 *   **bold**  *italic*  `code`  > blockquote  - list  1. ordered  [link](url)
 *
 * Nothing else makes it through. HTML in the input is escaped first
 * so injection is impossible.
 *
 * Phase 11 swap candidate: use a vetted library like `marked` +
 * `dompurify`. For now this minimal sanitizer keeps the dep tree
 * lean and is deterministic.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  // Order matters: code first (locks down the literal), then bold/italic, then links.
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?:^|\W)\*([^*\s][^*]*)\*(?=\W|$)/g, (match, body: string) => {
    const prefix = match.startsWith('*') ? '' : match[0];
    return `${prefix}<em>${body}</em>`;
  });
  // Markdown links — capture text + url; allow http/https/mailto only.
  out = out.replace(
    /\[([^\]]+)\]\(((?:https?|mailto):[^)\s]+)\)/g,
    (_, label: string, url: string) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  return out;
}

function renderBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = (): void => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      flushParagraph();
      closeList();
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
      continue;
    }
    const ulMatch = /^[-*] (.*)$/.exec(line);
    if (ulMatch) {
      flushParagraph();
      if (listKind !== 'ul') {
        closeList();
        out.push('<ul>');
        listKind = 'ul';
      }
      out.push(`<li>${renderInline(ulMatch[1]!)}</li>`);
      continue;
    }
    const olMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      flushParagraph();
      if (listKind !== 'ol') {
        closeList();
        out.push('<ol>');
        listKind = 'ol';
      }
      out.push(`<li>${renderInline(olMatch[1]!)}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

export function renderTextBlock(config: unknown): TextBlockPayload {
  const parsed = textBlockConfigSchema.parse(config);
  return {
    safeHtml: renderBlocks(parsed.markdown),
    heading: parsed.heading,
  };
}
