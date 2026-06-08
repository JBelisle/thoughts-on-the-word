// Blogger -> Astro content migration.
//
// Reads a Blogger Takeout Atom export (feed.atom) and writes Markdown files into
// the content collections, plus the matching 301 redirect lines.
//
// Usage:
//   node scripts/import-blogger.mjs <feed.atom> [--out DIR] [--sample "Title A","Title B"] [--dry]
//
// Classification (by Blogger category, with title fallbacks):
//   category 'JBT'         -> translations  (/translations/<slug>)
//   category 'Thoughts On' -> thoughts      (/thoughts/<slug>)
//   otherwise              -> articles      (/articles/<slug>, type: Theology)
//   a few known slugs      -> plans         (filled in place)
//
// Turndown must be available (npm install turndown --no-save).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const feedPath = args.find((a) => !a.startsWith('--')) ?? join(projectRoot, 'feed.atom');
const outDir = argVal('--out') ?? join(projectRoot, 'src', 'content');
const dry = args.includes('--dry');
const sampleTitles = (argVal('--sample') ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

// Known posts that map to existing reading-plan files rather than articles.
const PLAN_SLUGS = {
  'runway-to-daily-bible-reading': 'runway-to-daily-reading',
  'bible-in-a-year-the-scriptures-of-the-early-church': 'scriptures-of-the-early-church',
};
// Known articles whose repo slug differs from the Blogger slug.
const ARTICLE_SLUG_OVERRIDE = {
  'the-gospel-of-mark-as-the-sequel-to-chronicles': 'mark-as-sequel-to-chronicles',
};
// Manual `passages` overrides (keyed by final slug) for posts where the title alone
// under- or over-states what was actually discussed — determined by reading the body.
// thoughts-on-acts-24 is titled for Acts 24 but also has a full section on Proverbs.
const PASSAGE_OVERRIDES = {
  'thoughts-on-acts-24': ['Acts 24', 'Proverbs 20'],
};

// ---- xml helpers ----------------------------------------------------------
const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // amp last

function field(entry, tag) {
  const m = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
}
function contentOf(entry) {
  const m = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/);
  return m ? decodeEntities(m[1]) : '';
}
function categories(entry) {
  return [...entry.matchAll(/term='([^']+)'/g)].map((m) => m[1]);
}

// ---- passage helpers ------------------------------------------------------
// Full day's reading from the BibleGateway "search=" param (URL-decoded).
function readingFromBody(html) {
  const m = html.match(/search=([^"&]+)/);
  if (!m) return [];
  const decoded = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
  return decoded
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
// Normalize one reference token: trim, drop a leading "The ".
const normRef = (s) => s.trim().replace(/^the\s+/i, '').trim();
// A token looks like a real reference only if it contains a book name (a letter).
const looksLikeRef = (s) => /[A-Za-z]/.test(s);

// Book names + aliases from books.ts, so we can keep only title tokens that are
// real scripture references (drops non-passage titles like "One Year of this Blog").
const BOOK_NAMES = (() => {
  const bt = readFileSync(join(projectRoot, 'src', 'data', 'books.ts'), 'utf-8');
  const set = new Set();
  for (const m of bt.matchAll(/name:\s*'([^']+)'/g)) set.add(m[1].toLowerCase());
  for (const m of bt.matchAll(/aliases:\s*\[([^\]]*)\]/g))
    for (const a of m[1].matchAll(/'([^']+)'/g)) set.add(a[1].toLowerCase());
  return [...set].sort((a, b) => b.length - a.length);
})();
const resolvesToBook = (ref) => {
  const l = ref.trim().toLowerCase();
  return BOOK_NAMES.some((n) => l === n || l.startsWith(n + ' '));
};

// All scripture references cited in the body, reduced to chapter level and deduped.
// Used for theology articles, which (unlike thoughts) aren't titled by passage.
function bodyReferences(html) {
  const out = [];
  for (const m of html.matchAll(/search=([^"&]+)/g)) {
    const decoded = decodeURIComponent(m[1].replace(/\+/g, ' '));
    for (const part of decoded.split(/[;,]/)) {
      const ref = normRef(part.replace(/:\d+(?:-\d+)?/g, '')); // drop verse parts
      if (ref && looksLikeRef(ref) && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

// What the post is actually about, from the title. Titles join multiple passages
// with ";", "&", or " and " (e.g. "Numbers 26 & 1 Peter 3") — split them all out.
function passagesFromTitle(title) {
  let t = title.trim();
  t = t.replace(/^Thoughts?\s+on\s+/i, ''); // "Thoughts on " / "Thought on "
  t = t.replace(/\([^)]*\)/g, ' '); // drop parentheticals: "(JBT)", "(kind of…)"
  if (!t) return [];
  return t
    .split(/\s*[;&]\s*|\s+and\s+/i)
    .map(normRef)
    .filter((s) => s && looksLikeRef(s) && resolvesToBook(s)); // keep only real refs
}

// ---- body cleanup ---------------------------------------------------------
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});
// Preserve verse-number superscripts in JBT translations; Astro renders inline HTML.
turndown.keep(['sup']);

const dateOnly = (iso) => (iso || '').slice(0, 10);

function stripBannerImage(html) {
  // Leading <div class="separator">...<img .../></div> template banner.
  return html.replace(/<div class="separator"[\s\S]*?<\/div>/i, '');
}
function stripReadingLine(html) {
  // The italic "Today's reading: <a ...>...</a>" lead paragraph.
  return html.replace(/<p[^>]*>\s*<i>\s*Today[’']?s reading:[\s\S]*?<\/i>\s*<\/p>/i, '');
}
// old Blogger URL path -> new relative route; filled in pass 1.
const linkMap = new Map();
function rewriteLinks(md) {
  return md.replace(
    /\]\((?:https?:\/\/(?:www\.)?thoughtsontheword\.com)?(\/[^)\s]+\.html)\)/g,
    (whole, path) => (linkMap.has(path) ? `](${linkMap.get(path)})` : whole),
  );
}
// Chapters a translation actually contains, from its "Chapter N" headings.
function translationPassages(html, title) {
  const book = passagesFromTitle(title)[0]; // e.g. "1 Corinthians"
  if (!book) return [];
  const chapters = [...html.matchAll(/<h[1-3][^>]*>\s*Chapter\s+(\d+)/gi)].map((m) => +m[1]);
  if (!chapters.length) return [book];
  const uniq = [...new Set(chapters)].sort((a, b) => a - b);
  const out = [];
  let start = uniq[0], prev = uniq[0];
  for (let i = 1; i <= uniq.length; i++) {
    if (uniq[i] === prev + 1) { prev = uniq[i]; continue; }
    out.push(start === prev ? `${book} ${start}` : `${book} ${start}-${prev}`);
    start = prev = uniq[i];
  }
  return out;
}
function cleanBody(html, { keepBanner }) {
  let h = html;
  if (!keepBanner) h = stripBannerImage(h);
  h = stripReadingLine(h);
  let md = turndown.turndown(h);
  md = md.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Some posts kept a stray "Today's reading:" lead line that the HTML strip missed;
  // the reading now lives in the header, so drop it from the body.
  md = md.replace(/^\s*[*_]*\s*Today[’'`]?s reading:.*\n+/im, '').trimStart();
  return rewriteLinks(md);
}

function summaryFrom(md) {
  const para = md
    .split(/\n{2,}/)
    .find((p) => {
      const t = p.trim();
      return t && !/^[#>*<-]/.test(t) && !/^\[?!?\[/.test(t); // skip headings, images, linked images, rules, html
    });
  if (!para) return undefined;
  const text = para.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  return text.slice(0, 157).replace(/\s+\S*$/, '') + '…';
}

// ---- yaml emit ------------------------------------------------------------
const yamlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
function frontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlStr(item)}`);
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else if (k === 'date') {
      lines.push(`${k}: ${v}`); // ISO, unquoted for z.coerce.date
    } else {
      lines.push(`${k}: ${yamlStr(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ---- main -----------------------------------------------------------------
const ROUTE_BASE = { thoughts: '/thoughts', translations: '/translations', articles: '/articles', plans: '/reading-plans' };

// Pass 0: parse + classify every POST (no I/O), so we can build the link map.
function parse(entry, idx) {
  const type = field(entry, 'blogger:type');
  if (type !== 'POST') return null;
  const status = field(entry, 'blogger:status');
  const rawTitle = decodeEntities(field(entry, 'title')).trim();
  const filename = field(entry, 'blogger:filename'); // /YYYY/MM/slug.html
  const published = field(entry, 'published');
  const cats = categories(entry);
  const html = contentOf(entry);
  const isDraft = status === 'DRAFT';
  const bloggerSlug = filename ? filename.replace(/^.*\/(.+)\.html$/, '$1') : '';

  let collection, keepBanner;
  if (cats.includes('JBT') || /\(JBT\)\s*$/i.test(rawTitle)) {
    collection = 'translations';
    keepBanner = false;
  } else if (cats.includes('Thoughts On')) {
    collection = 'thoughts';
    keepBanner = false;
  } else {
    collection = 'articles';
    keepBanner = true; // theology keeps its head image
  }
  if (PLAN_SLUGS[bloggerSlug]) collection = 'plans';

  let slug = bloggerSlug;
  if (collection === 'plans') slug = PLAN_SLUGS[bloggerSlug];
  else if (collection === 'articles' && ARTICLE_SLUG_OVERRIDE[bloggerSlug])
    slug = ARTICLE_SLUG_OVERRIDE[bloggerSlug];
  if (!slug)
    slug = rawTitle
      ? rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      : `untitled-draft-${idx}`;

  const newPath = `${ROUTE_BASE[collection]}/${slug}`;
  return { type, isDraft, rawTitle, filename, published, cats, html, collection, keepBanner, slug, bloggerSlug, newPath };
}

const xml = readFileSync(feedPath, 'utf-8');
const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
const items = entries.map((e, i) => parse(e, i)).filter(Boolean);

// Two Blogger posts can share a slug basename across different months (e.g.
// /2023/04/thoughts-on-mark-1 and /2024/04/thoughts-on-mark-1 — the same chapter
// revisited in a later year). Disambiguate colliding slugs by appending the year.
const groups = new Map();
for (const it of items) {
  const key = `${it.collection}/${it.slug}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(it);
}
for (const group of groups.values()) {
  if (group.length < 2) continue;
  group.sort((a, b) => (a.published || '').localeCompare(b.published || ''));
  const used = new Set();
  for (const it of group) {
    const year = (it.published || '').slice(0, 4) || 'x';
    let s = `${it.slug}-${year}`;
    let n = 2;
    while (used.has(s)) s = `${it.slug}-${year}-${n++}`;
    used.add(s);
    it.slug = s;
    it.newPath = `${ROUTE_BASE[it.collection]}/${it.slug}`;
  }
}

// Pass 1: build old-URL -> new-route map for internal link rewriting.
for (const it of items) if (it.filename) linkMap.set(it.filename, it.newPath);

const redirects = [];
const written = [];
const skipped = [];
const review = []; // posts whose secondary reading passage may also be discussed

// PAGE entries: reported, not auto-converted.
for (const entry of entries) {
  if (field(entry, 'blogger:type') !== 'PAGE') continue;
  const t = decodeEntities(field(entry, 'title')).trim();
  skipped.push({ title: t || '(untitled page)', why: 'PAGE — handle manually', filename: field(entry, 'blogger:filename') });
}

// Pass 2: render.
for (const it of items) {
  const { collection, isDraft, rawTitle, filename, published, html, keepBanner, slug, newPath } = it;
  if (sampleTitles.length && !sampleTitles.includes(rawTitle)) continue;

  const title = rawTitle || (isDraft ? 'Untitled draft' : slug);
  const reading = readingFromBody(html); // full day's reading
  let passages = passagesFromTitle(rawTitle);
  if (collection === 'translations') passages = translationPassages(html, rawTitle);
  else if (collection === 'articles') passages = bodyReferences(html); // essays cite refs in body
  if (PASSAGE_OVERRIDES[slug]) passages = PASSAGE_OVERRIDES[slug]; // body-read corrections

  // thoughts with no reading link fall back to the title passage
  const readingOut = collection === 'thoughts' ? (reading.length ? reading : passages) : undefined;

  // flag for review: a secondary reading passage whose book is also discussed in the body
  if (collection === 'thoughts' && reading.length > 1) {
    const bodyText = html.replace(/<[^>]+>/g, ' ');
    const titleBooks = new Set(passages.map((p) => p.replace(/\s+\d.*$/, '').toLowerCase()));
    for (const r of reading) {
      const book = r.replace(/\s+\d.*$/, '');
      if (titleBooks.has(book.toLowerCase())) continue;
      const count = (bodyText.match(new RegExp(`\\b${book.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) || []).length;
      if (count > 1) review.push({ slug, title, primary: passages, alsoMaybe: r, mentions: count });
    }
  }

  const md = cleanBody(html, { keepBanner });
  const date = dateOnly(published);

  let fm;
  if (collection === 'thoughts') {
    fm = frontmatter({ title, date, reading: readingOut, passages, summary: summaryFrom(md), draft: isDraft || undefined });
  } else if (collection === 'translations') {
    fm = frontmatter({ title, date, passages, summary: `Joe's Bible Translation — ${passages.join('; ') || title}.` });
  } else if (collection === 'plans') {
    fm = null;
  } else {
    fm = frontmatter({ title, date, type: 'Theology', passages, summary: summaryFrom(md), draft: isDraft || undefined });
  }

  if (filename) redirects.push(`${filename.padEnd(60)} ${newPath}  301`);

  if (collection === 'plans') {
    skipped.push({ title, why: `plan — paste body into src/content/plans/${slug}.md manually`, filename });
    continue; // don't overwrite hand-authored plan front-matter
  }

  const dir = join(outDir, collection);
  const file = join(dir, `${slug}.md`);
  if (!dry) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${fm}\n\n${md}\n`);
  }
  written.push({ collection, slug, title, file });
}

// ---- report ---------------------------------------------------------------
const byCol = written.reduce((a, w) => ((a[w.collection] = (a[w.collection] || 0) + 1), a), {});
console.log(`\nWrote ${written.length} files${dry ? ' (dry run, nothing saved)' : ''}:`, byCol);
if (sampleTitles.length) for (const w of written) console.log(`  ${w.collection}: ${w.file}`);
if (skipped.length) {
  console.log(`\nSkipped / manual (${skipped.length}):`);
  for (const s of skipped) console.log(`  - [${s.why}] ${s.title}`);
}
if (review.length) {
  console.log(`\nReview — secondary reading passage also mentioned in body (${review.length}):`);
  for (const r of review.slice(0, 40))
    console.log(`  - ${r.slug}: wrote "${r.primary.join(', ')}", reading also had "${r.alsoMaybe}" (${r.mentions}x)`);
  if (review.length > 40) console.log(`  ...and ${review.length - 40} more`);
}

// redirects file (paste-ready) unless dry
if (!dry && !sampleTitles.length) {
  const rf = join(projectRoot, 'redirects.generated.txt');
  writeFileSync(rf, redirects.join('\n') + '\n');
  console.log(`\nWrote ${redirects.length} redirect lines -> ${rf}`);
}
