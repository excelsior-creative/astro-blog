import { SITE } from "@config";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(SITE.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(["others"]),
      // Content-layer image() resolves metadata after schema parsing, so image
      // dimensions are checked by scripts/check-content-images.mjs at build time.
      // Public paths and remote URLs must match before image(), which otherwise
      // treats every string as a source import in the content layer.
      ogImage: z
        .string()
        .regex(/^(?:\/|[a-z][a-z0-9+.-]*:|$)/i)
        .or(image())
        .optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
    }),
});

export const collections = { blog };
