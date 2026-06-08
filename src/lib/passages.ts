import { books, type Book } from '../data/books';
import type { CollectionEntry } from 'astro:content';

// Anything surfaced by book/chapter: articles, thoughts, and translations carry `passages`.
type Article =
  | CollectionEntry<'articles'>
  | CollectionEntry<'thoughts'>
  | CollectionEntry<'translations'>;

// Build a name/alias -> Book lookup, matched greedily longest-first
// so "1 John" wins over "John", "Song of Solomon" over nothing, etc.
const lookup = new Map<string, Book>();
for (const b of books) {
  lookup.set(b.name.toLowerCase(), b);
  for (const a of b.aliases ?? []) lookup.set(a.toLowerCase(), b);
}
const candidateNames = [...lookup.keys()].sort((a, b) => b.length - a.length);

export interface Ref {
  book: Book;
  /** Chapter numbers this reference touches. Empty = whole/unspecified book. */
  chapters: number[];
}

/** Parse one reference like "Genesis 3:1-15" or "1 John 2" into a Ref. */
export function parseReference(raw: string): Ref | null {
  const ref = raw.trim();
  if (!ref) return null;
  const lower = ref.toLowerCase();
  let matched: string | null = null;
  for (const name of candidateNames) {
    if (lower === name || lower.startsWith(name + ' ')) {
      matched = name;
      break;
    }
  }
  if (!matched) return null;
  const book = lookup.get(matched)!;
  const rest = ref.slice(matched.length).trim();
  return { book, chapters: parseChapters(rest, book) };
}

function parseChapters(spec: string, book: Book): number[] {
  if (!spec) return book.chapters === 1 ? [1] : [];
  const token = spec.split(/[,;]/)[0].trim(); // first clause only
  const [start, end] = token.split('-').map((s) => s.trim());
  const startHasColon = start.includes(':');
  const startChap = parseInt(start.split(':')[0], 10);
  if (Number.isNaN(startChap)) return [];
  let endChap = startChap;
  if (end !== undefined && end !== '') {
    if (end.includes(':')) {
      endChap = parseInt(end.split(':')[0], 10); // cross-chapter range, e.g. 1:1-2:25
    } else if (startHasColon) {
      endChap = startChap; // verse range inside one chapter, e.g. 3:1-15
    } else {
      endChap = parseInt(end, 10); // chapter range, e.g. 6-9
    }
  }
  if (Number.isNaN(endChap)) endChap = startChap;
  const out: number[] = [];
  for (let i = startChap; i <= endChap && i <= book.chapters; i++) out.push(i);
  return out;
}

/** Parse a front-matter passages array; supports ";"-joined multi-book strings. */
export function parsePassages(passages: string[]): Ref[] {
  const refs: Ref[] = [];
  for (const p of passages ?? []) {
    for (const part of p.split(';')) {
      const r = parseReference(part);
      if (r) refs.push(r);
    }
  }
  return refs;
}

export const articleRefs = (a: Article): Ref[] => parsePassages(a.data.passages ?? []);

/** Set of chapter numbers within a book that have at least one article. */
export function chaptersWithContent(articles: Article[], slug: string): Set<number> {
  const s = new Set<number>();
  for (const a of articles)
    for (const r of articleRefs(a)) if (r.book.slug === slug) r.chapters.forEach((c) => s.add(c));
  return s;
}

/** Articles for a book, each tagged with the chapters it covers in that book. */
export function articlesForBook(
  articles: Article[],
  slug: string,
): { article: Article; chapters: number[] }[] {
  const out: { article: Article; chapters: number[] }[] = [];
  for (const a of articles) {
    const ch = new Set<number>();
    let inBook = false;
    for (const r of articleRefs(a))
      if (r.book.slug === slug) {
        inBook = true;
        r.chapters.forEach((c) => ch.add(c));
      }
    if (inBook) out.push({ article: a, chapters: [...ch].sort((x, y) => x - y) });
  }
  return out.sort((a, b) => (a.chapters[0] ?? 0) - (b.chapters[0] ?? 0));
}

/** Short human label for a ref, e.g. "Genesis 1–2" or "Obadiah". */
export function refLabel(r: Ref): string {
  if (!r.chapters.length) return r.book.name;
  const first = r.chapters[0];
  const last = r.chapters[r.chapters.length - 1];
  return first === last ? `${r.book.name} ${first}` : `${r.book.name} ${first}–${last}`;
}
