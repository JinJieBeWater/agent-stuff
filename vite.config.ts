import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
  lint: {
    ignorePatterns: ["node_modules/**", "**/node_modules/**"],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    // show-me stays byte-close to HumanLayer upstream, including its code style.
    ignorePatterns: ["node_modules/**", "**/node_modules/**", "skills/*/show-me/SKILL.md"],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
