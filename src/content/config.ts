import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // Drives the Theology list and the tag shown on cards.
    type: z.enum(['Theology', 'Reading notes']).default('Theology'),
    // The heart of the site: which passages this article covers.
    // Examples: "Genesis 3:1-15", "Mark 1:12-13", "Genesis 6-9", "Nahum 1-3; Habakkuk 1-3"
    passages: z.array(z.string()).default([]),
    summary: z.string().optional(),
    // Optional header image. When set, it renders at the top of the article and is
    // used as the card thumbnail (book pages, Theology) and the search-result image.
    titleImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const thoughts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/thoughts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // The full day's reading that prompted the post — shown in the header, not indexed.
    reading: z.array(z.string()).default([]),
    // What the post actually discusses; this is what drives book/chapter browsing.
    passages: z.array(z.string()).default([]),
    summary: z.string().optional(),
    titleImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const translations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/translations' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // Which book/chapters this translation covers; surfaced in book browsing.
    passages: z.array(z.string()).default([]),
    summary: z.string().optional(),
    titleImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const plans = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/plans' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    titleImage: z.string().optional(),
    pdf: z.string().url().optional(),
    sheet: z.string().url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, thoughts, translations, plans };
