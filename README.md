# Thoughts on the Word

A static rebuild of [thoughtsontheword.com](https://www.thoughtsontheword.com) on
[Astro](https://astro.build), organized as a **library** rather than a blog feed:
browse studies by book and chapter, with quick paths to theology essays and reading
plans, and full-text search. Light/dark theme toggle included.

## Quick start

```bash
npm install
npm run dev        # local dev server at http://localhost:4321
npm run build      # builds to dist/ and indexes it for search (Pagefind)
npm run preview    # serve the built site (search works here, not in dev)
```

> `npm run dev` does not generate the search index. Use `npm run build && npm run preview`
> to test search locally. `npm run build:nosearch` builds without the Pagefind step.

## How it's organized

```
src/
  data/books.ts          All 66 books (standard order), chapter counts, slugs, aliases
  lib/passages.ts        Parses `passages` front-matter into book/chapter index data
  content/
    config.ts            Collection schemas (articles, plans)
    articles/*.md         Your studies and essays
    plans/*.md            Your reading plans
  components/            Header (nav + theme toggle), Footer, BookGrid, ArticleCard
  layouts/Base.astro     Page shell: fonts, icons, SEO meta, no-flash theme init
  pages/
    index.astro          Homepage hub
    browse/              Full browse-by-book grid
    books/[book].astro   One page per book: chapter grid + live chapter filter
    theology/            Essay list
    reading-plans/       Plan list + one page per plan
    articles/[slug].astro  Article pages with passage links back into the index
    search.astro         Pagefind search UI
styles/global.css        Brand tokens + light/dark themes (edit to re-skin)
public/_redirects        Blogger -> new-URL 301s for Cloudflare Pages
```

## Adding content

Drop a Markdown file in `src/content/articles/`. The filename becomes the URL slug
(`/articles/<filename>`). Front-matter:

```yaml
---
title: "Jesus' wilderness temptation"
date: 2019-12-02
type: Theology            # "Theology" or "Reading notes"
passages:                  # the important part — what this article covers
  - "Genesis 3:1-15"
  - "Mark 1:12-13"
  - "Hebrews 2"
summary: "One-line description used in meta tags."
draft: false
---

Body in Markdown…
```

`passages` is what powers everything. An article listing `Genesis 3:1-15` and
`Mark 1:12-13` automatically appears on both the Genesis page (under chapter 3) and
the Mark page (under chapter 1), and its own page links back to both. Supported
reference shapes:

| You write | Indexed chapters |
|-----------|------------------|
| `Genesis 1` | 1 |
| `Genesis 1-2` | 1, 2 |
| `Genesis 3:1-15` | 3 (verse range stays in one chapter) |
| `Genesis 6-9` | 6, 7, 8, 9 |
| `Obadiah` | 1 (single-chapter books) |
| `Nahum 1-3; Habakkuk 1-3` | Nahum 1–3 and Habakkuk 1–3 |

Book names use standard spellings; a few aliases are accepted (`Psalm` → Psalms,
`Song of Solomon` → Song of Songs). See `src/data/books.ts`.

Reading plans live in `src/content/plans/` with `title`, `date`, `summary`, and
optional `pdf` / `sheet` links.

## Theming

`src/styles/global.css` defines the palette as CSS variables — light by default,
with a `[data-theme="dark"]` block. The toggle in the header writes the choice to
`localStorage`; on a first visit the site honors the browser's `prefers-color-scheme`.
Change the `--accent`, `--bg`, etc. variables to adjust the whole site at once.
Fonts are Open Sans (UI) and Source Serif 4 (article prose), loaded in `Base.astro`.

## Search

Search uses [Pagefind](https://pagefind.app), which indexes the built site as part of
`npm run build`. Only article and plan pages are indexed (they carry
`data-pagefind-body`); navigation pages are skipped.

## Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command: `npm run build`  ·  Build output directory: `dist`.
4. Add your custom domain under the project's **Custom domains** tab and point DNS
   (Cloudflare issues HTTPS automatically). Update `site` in `astro.config.mjs` to match.

Cloudflare rebuilds on every push — no GitHub Action required. (An optional
`.github/workflows/deploy.yml` is included if you'd rather drive deploys from GitHub.)

## Migrating from Blogger

1. Blogger → **Settings → Manage blog → Back up content** exports all posts as one XML.
2. Convert each post to a Markdown file in `src/content/articles/`, adding a `passages:`
   list (this is the one piece of hand-tagging that makes the book index work).
3. Build the `public/_redirects` map from your old URLs to the new ones so existing
   links and Google ranking carry over. A few examples are already in the file.
4. Re-point your domain's DNS from Blogger to Cloudflare Pages.
