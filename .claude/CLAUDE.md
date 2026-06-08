# AGENTS.md

Operational guide for AI coding agents working in this repository.
Humans: see `README.md` for full setup and authoring docs. Keep this file lean.

This is the Astro static-site rebuild of **thoughtsontheword.com** — a Bible-study
"library" organized so studies are findable by book and chapter. Static output,
deployed to Cloudflare Pages.

## Commands

- `npm install` — install dependencies (Node 20+).
- `npm run dev` — local dev server at http://localhost:4321. Does **not** build the search index.
- `npm run build` — builds to `dist/` **and** runs Pagefind to index it.
- `npm run preview` — serve the built site; the only way to test search locally.
- `npm run build:nosearch` — build without the Pagefind step (faster iteration).

**Always run `npm run build` and confirm it finishes with no errors before considering a task done.**

## Stack and conventions

- Astro 5 with content-layer collections (`glob` loader); schemas in `src/content/config.ts`.
- Plain vanilla JS for the small interactive pieces — the theme toggle in
  `src/components/Header.astro` and the chapter filter in `src/pages/books/[book].astro`.
  Do **not** add React/Vue/Svelte or any client framework for these.
- TypeScript for `src/data/` and `src/lib/`.
- A filename in `src/content/articles/` or `src/content/plans/` becomes its URL slug.

## The core invariant: `passages` drives the index

The book/chapter pages, homepage highlights, and cross-references are all generated
from each article's `passages` front-matter. So:

- Every article in `src/content/articles/` must have a valid `passages` list.
- Parsing lives in `src/lib/passages.ts`. Accepted reference shapes:
  `Genesis 1`, `Genesis 1-2`, `Genesis 3:1-15` (verse range stays in ch. 3),
  `Genesis 6-9`, single-chapter books written as just `Obadiah`, and `;`-joined
  multi-book strings like `Nahum 1-3; Habakkuk 1-3`.
- `src/data/books.ts` lists all 66 books in standard Protestant order with chapter
  counts and slugs. **The slugs are the URL contract** (`/books/<slug>`). Do not
  reorder or rename them without updating `public/_redirects`.

## Theming

- Light and dark must both work. The toggle writes to `localStorage` and defaults to
  the OS `prefers-color-scheme` on first visit.
- Colors come only from the CSS variables in `src/styles/global.css`
  (`--bg`, `--surface`, `--text`, `--accent`, ...). **Never hardcode a hex value in a
  component** — it will be wrong in one of the two themes.

## URLs and migration

Old Blogger URLs (`/YYYY/MM/slug.html`) must keep working. Whenever you add or change
a public URL, add a matching `301` line to `public/_redirects`.

### Migrating one Blogger post (repeatable task)

1. Create `src/content/articles/<slug>.md` with front-matter:
   `title`, `date`, `type` (`Theology` or `Reading notes`), `passages`, `summary`.
2. Derive `passages` from the post's book/chapter labels, then sanity-check against the
   body for the specific chapters it actually discusses.
3. Add the old Blogger URL → `/articles/<slug>` as a `301` in `public/_redirects`.
4. Run `npm run build`, open the relevant `/books/<book>` page, and confirm the
   chapter(s) are highlighted and the article appears under them when filtered.

## Always / ask first / never

- **Always:** run `npm run build` to verify; add a redirect when a public URL changes;
  keep both themes working.
- **Ask first:** changing the URL structure, the book ordering, the theme palette, or
  adding a dependency.
- **Never:** commit `node_modules/` or `dist/`; hardcode colors in components; remove
  `passages` from an article; rename a book slug without a matching redirect.
