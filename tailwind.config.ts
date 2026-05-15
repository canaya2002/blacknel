import type { Config } from 'tailwindcss';

/**
 * Tailwind v4 is CSS-first: design tokens live in `app/globals.css` inside
 * `@theme { ... }`. This file is kept as a thin shim so editor plugins
 * (Tailwind IntelliSense, prettier-plugin-tailwindcss) can resolve the
 * config. Most extension still happens in CSS.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
};

export default config;
