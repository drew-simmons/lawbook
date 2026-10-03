import { defineConfig } from "blume";

export default defineConfig({
  title: "lawbook",
  description: "lawbook command-line tool.",
  content: {
    root: "content",
  },
  github: {
    owner: "drew-simmons",
    repo: "lawbook",
    branch: "main",
    dir: "docs",
  },
  deployment: {
    output: "static",
    site: "https://drew-simmons.github.io",
    base: "/lawbook",
  },
  search: {
    provider: "orama",
  },
  ai: {
    llmsTxt: true,
  },
  seo: {
    sitemap: true,
    robots: true,
  },
  lastModified: { type: "git" },
});
