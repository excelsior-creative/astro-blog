import { defineConfig } from "astro/config";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";

// https://astro.build/config
export default defineConfig({
  site: SITE.website,
  compressHTML: true,
  integrations: [react(), sitemap()],
  markdown: {
    processor: unified({
      remarkPlugins: [
        remarkToc,
        [
          remarkCollapse,
          {
            test: "Table of contents",
          },
        ],
      ],
    }),
    shikiConfig: {
      theme: "one-dark-pro",
      transformers: [
        {
          name: "preserve-code-wrapping",
          pre(node) {
            node.properties.style +=
              ";white-space:pre-wrap;word-wrap:break-word";
          },
        },
      ],
    },
  },
  vite: {
    css: { postcss: { plugins: [tailwind(), autoprefixer()] } },
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  scopedStyleStrategy: "where",
});
