import { defineConfig } from "blume";

export default defineConfig({
  title: "lawbook",
  description: "Checks code standards with repeatable rules and LLM decisions.",
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
    site: "https://drew-simmons.github.io",
    base: "/lawbook",
  },
  agents: {
    llmsTxt: true,
  },
  seo: {
    sitemap: true,
    robots: true,
  },
  lastModified: "git",
});
