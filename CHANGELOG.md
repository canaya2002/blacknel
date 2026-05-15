# Changelog

All notable changes to Blacknel are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 1 / Commit 1

- Project scaffold for Blacknel.
- Tooling stack:
  - Next.js 16 + React 19 + TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
  - Tailwind CSS v4 with `@tailwindcss/postcss`. Design tokens are CSS-first
    and will land with the app shell in Commit 4.
  - ESLint 9 flat config extending `next/core-web-vitals` + `next/typescript`.
  - Prettier 3 with `prettier-plugin-tailwindcss`.
  - Vitest 2 + jsdom + `@vitejs/plugin-react`.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`,
  `format`, `format:check`, `verify`.
- Pinned tooling: `engines.node: "22.x"`, `packageManager: "pnpm@9.15.0"`.
- `.npmrc` with `engine-strict=false` so local dev on Node 24 is unblocked
  while CI/Vercel target Node 22.
- `.gitignore`, `.editorconfig`, `.prettierignore` baseline.
- `.env.example` with placeholders for app URL, Supabase, database, and
  Blacknel mock flags.
- `README.md` describing stack, requirements, scripts and conventions.
- `types/global.d.ts` ambient declarations placeholder.
