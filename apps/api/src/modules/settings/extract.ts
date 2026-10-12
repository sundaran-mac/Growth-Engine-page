/**
 * Text extraction for knowledge documents: PDF (unpdf), DOCX (mammoth), HTML (html-to-text),
 * Markdown and plain text as is. The result is trimmed and capped.
 */
import { convert as htmlToText } from 'html-to-text';
import mammoth from 'mammoth';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';
import { AppError } from '../../lib/errors.js';

/** About 50k tokens. Longer text is cut; the summary and context only need the start. */
export const MAX_EXTRACTED_CHARS = 200_000;

export type ExtractKind = 'pdf' | 'docx' | 'html' | 'text';

/** Picks the extractor from the mime type, then the file name. Null when not supported. */
export function extractKindFor(mimeType: string | null, name?: string | null): ExtractKind | null {
  const mime = (mimeType ?? '').toLowerCase();
  const lower = (name ?? '').toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || /\.html?$/.test(lower))
    return 'html';
  if (mime.startsWith('text/') || /\.(md|markdown|txt)$/.test(lower)) return 'text';
  return null;
}

/** Collapses runs of blank lines and trailing spaces; caps the length. */
export function normaliseText(text: string): string {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > MAX_EXTRACTED_CHARS ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : cleaned;
}

export function htmlToPlain(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
}

export async function extractText(body: Buffer, kind: ExtractKind): Promise<string> {
  let text: string;
  try {
    switch (kind) {
      case 'pdf': {
        const pdf = await getDocumentProxy(new Uint8Array(body));
        text = (await pdfText(pdf, { mergePages: true })).text;
        break;
      }
      case 'docx':
        text = (await mammoth.extractRawText({ buffer: body })).value;
        break;
      case 'html':
        text = htmlToPlain(body.toString('utf8'));
        break;
      case 'text':
        text = body.toString('utf8');
        break;
    }
  } catch (err) {
    throw new AppError({
      status: 422,
      code: 'DOCUMENT_UNREADABLE',
      title: 'Document not readable',
      detail: 'The text could not be read from this file.',
      cause: err,
    });
  }
  const out = normaliseText(text);
  if (!out) {
    throw new AppError({
      status: 422,
      code: 'DOCUMENT_EMPTY',
      title: 'No text found',
      detail: 'This document has no readable text (a scanned PDF needs OCR first).',
    });
  }
  return out;
}
