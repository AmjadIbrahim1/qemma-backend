// backend/src/modules/ai/_shared/pdf-parser.js
// ✅ NEW (AI contest question generation): textbook text extraction + chunking, with a
// lazy per-file in-memory cache. Used to turn the Arabic & English textbooks into text
// chunks that are fed to Groq as context for MCQ generation.
//
// Supports TWO input formats (selected by file extension):
//   - `.txt`  → plain UTF-8 text (e.g. an OCR'd Arabic textbook, arabic.txt). Read via
//               fs.readFileSync(path, 'utf8') which handles Arabic correctly.
//   - `.pdf`  → parsed with `pdfjs-dist` (Mozilla, pure JS). For text-only extraction no
//               canvas is required — we call getTextContent() on each page and join the
//               text items.
//
// Textbooks are static, so each file is parsed once and the chunks are cached for the
// process lifetime (no re-parse per cron tick).
//
// Caching: module-level Map keyed by absolute file path → { text, chunks }.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Chunking config ──────────────────────────────────────────────────────────────
// ~3000-character chunks with a small overlap so questions draw from coherent passages
// without splitting sentences too aggressively. Applied uniformly to both Arabic (.txt)
// and English (.pdf) source material.
const CHUNK_CHAR_SIZE = 3000;
const CHUNK_OVERLAP   = 300;

// In-memory cache: absolutePath → { text: string, chunks: string[] }
const _cache = new Map();

// ── Resolve the textbooks directory ──────────────────────────────────────────────
// Default: backend/data/textbooks (configurable via TEXTBOOKS_DIR env). Resolved
// relative to this file: backend/src/modules/ai/_shared → ../../../../data/textbooks
// (4 levels up: _shared → ai → modules → src → backend).
function resolveTextbooksDir() {
  if (process.env.TEXTBOOKS_DIR) return path.resolve(process.env.TEXTBOOKS_DIR);
  return path.join(__dirname, '../../../../data/textbooks');
}

// ── Extract raw text from a PDF file (pdfjs-dist) ────────────────────────────────
async function extractTextFromPDF(filePath) {
  // Dynamic import keeps pdfjs out of the boot path if the job never runs (and isolates
  // the browser-field shim concerns to this module only).
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');

  const data  = new Uint8Array(fs.readFileSync(filePath));
  // getDocument params: disable worker (run inline in Node) + no canvas needed for text.
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // Disable the fake worker — runs in the main thread (fine for one-off batch jobs).
    disableWorker: true,
  }).promise;

  let fullText = '';
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Join text items with spaces; pdfjs returns individual tokens/glyphs.
    const pageText = content.items
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) fullText += pageText + '\n';
  }
  await doc.destroy();
  return fullText;
}

// ── Extract raw text from a plain-text file (UTF-8, e.g. OCR'd Arabic) ───────────
// fs.readFileSync with 'utf8' encoding handles Arabic correctly (no RTL issues at the
// byte level — Arabic is BMP UTF-8, read as proper code points).
function extractTextFromTxt(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ── Split text into overlapping chunks ───────────────────────────────────────────
function chunkText(text) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= CHUNK_CHAR_SIZE) return [cleaned];

  const chunks = [];
  const step = CHUNK_CHAR_SIZE - CHUNK_OVERLAP;
  for (let i = 0; i < cleaned.length; i += step) {
    chunks.push(cleaned.slice(i, i + CHUNK_CHAR_SIZE));
    // Stop once the remaining tail fits in one chunk to avoid a tiny trailing chunk.
    if (i + CHUNK_CHAR_SIZE >= cleaned.length) break;
  }
  return chunks;
}

// ── Public API: load + cache a textbook's text and chunks ────────────────────────
// `fileName` is resolved under the textbooks dir (e.g. 'arabic.txt', 'english.pdf').
// The format is selected by extension: .txt → plain UTF-8 read; .pdf → pdfjs extract.
// Returns { text, chunks }. Throws if the file is missing or parsing fails.
export async function loadTextbook(fileName) {
  const dir     = resolveTextbooksDir();
  const absPath = path.join(dir, fileName);

  if (_cache.has(absPath)) return _cache.get(absPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Textbook not found: ${absPath}`);
  }

  const ext  = path.extname(fileName).toLowerCase();
  let text;
  if (ext === '.txt') {
    text = extractTextFromTxt(absPath);
  } else if (ext === '.pdf') {
    text = await extractTextFromPDF(absPath);
  } else {
    throw new Error(`Unsupported textbook format: ${ext} (expected .txt or .pdf)`);
  }

  const chunks = chunkText(text);
  const result = { text, chunks };
  _cache.set(absPath, result);
  console.log(`📚 pdf-parser: loaded "${fileName}" — ${chunks.length} chunk(s), ${text.length} chars`);
  return result;
}

// ── Public API: pick a random chunk ──────────────────────────────────────────────
// With no `seed`, picks a uniformly random chunk — used by the generator so each batch
// draws from a varied part of the book. Optional `seed` is kept for deterministic tests.
export function pickChunk(chunks, seed) {
  if (!chunks || chunks.length === 0) return '';
  let idx;
  if (typeof seed === 'number') {
    // simple LCG-ish spread (deterministic — used by tests)
    idx = Math.abs(Math.floor(Math.sin(seed) * 10000)) % chunks.length;
  } else {
    idx = Math.floor(Math.random() * chunks.length);
  }
  return chunks[idx];
}

// ── Test helper: clear the cache (used by idempotency tests) ─────────────────────
export function _clearCache() {
  _cache.clear();
}

export { resolveTextbooksDir };
