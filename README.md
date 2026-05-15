# Blacknel

All-in-one SaaS for social media, reviews, messaging, AI replies, reputation
and reporting from a single web app.

> **Status:** Phase 1 / Commit 1 of 12 — tooling and project scaffold only.
> Source code lands in subsequent commits.

---

## Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript strict
- **Styling:** Tailwind CSS v4 (CSS-first config via `@theme`) + shadcn/ui
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, Realtime) + Drizzle ORM
- **Validation:** Zod everywhere at boundaries
- **Jobs:** Inngest (added later phases)
- **AI:** Anthropic SDK — Opus 4.7 + Haiku 4.5
- **Testing:** Vitest + jsdom + Testing Library
- **Hosting:** Vercel

See the project master document for the full architecture and the 12-phase
roadmap.

---

## Requirements

- **Node.js 22.x (LTS)** — target, pinned via `.nvmrc` and `.node-version`.
- **pnpm 9+** — required (no npm/yarn).
- **Git 2.40+**

### Node 22 — how to install

The repo pins Node 22 in two places:

- `engines.node: "22.x"` in `package.json` (what Vercel / CI honor)
- `.nvmrc` and `.node-version` at the repo root (what local version
  managers honor)

Pick whichever version manager you already use:

| Tool                              | Command                                       |
| --------------------------------- | --------------------------------------------- |
| [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows) | `nvm install 22 && nvm use 22` |
| [fnm](https://github.com/Schniz/fnm) | `fnm install 22 && fnm use 22`                |
| [Volta](https://volta.sh/)        | `volta install node@22` (auto-pins via `.node-version`) |
| [asdf](https://asdf-vm.com/)      | `asdf install nodejs 22 && asdf local nodejs 22` |
| [mise](https://mise.jdx.dev/)     | `mise use node@22`                            |

`engine-strict` is left **off** in `.npmrc` so pnpm will still install
on Node 24 with a non-fatal warning — convenient when you don't have a
version manager set up yet, but **do not ship from Node 24**. Vercel and
CI run on Node 22 and that's the only supported runtime.

---

## Setup

```bash
pnpm install
pnpm verify
```

Once Commit 2+ lands you will also need:

```bash
cp .env.example .env.local   # fill in Supabase URL / keys
pnpm db:migrate              # apply schema
pnpm db:seed                 # insert demo data
pnpm dev                     # start dev server on :3000
```

---

## Scripts

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `pnpm dev`         | Next.js dev server with Turbopack on `localhost:3000`   |
| `pnpm build`       | Production build                                        |
| `pnpm start`       | Start built app                                         |
| `pnpm lint`        | ESLint flat config, zero warnings allowed               |
| `pnpm typecheck`   | `tsc --noEmit` against strict TypeScript                |
| `pnpm test`        | Vitest single run                                       |
| `pnpm test:watch`  | Vitest watch mode                                       |
| `pnpm format`      | Prettier write across repo                              |
| `pnpm format:check`| Prettier check (CI-friendly)                            |
| `pnpm verify`      | Runs `lint` + `typecheck` + `test` — must be green      |

`pnpm verify` must pass before any commit closes the phase.

---

## Repository layout

This will grow as commits land. As of Commit 1:

```
.
├── .editorconfig
├── .env.example
├── .gitignore
├── .npmrc
├── .prettierignore
├── .prettierrc.json
├── CHANGELOG.md
├── README.md
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── types/
│   └── global.d.ts
└── vitest.config.ts
```

The full target structure is documented in the project master document.

---

## Conventions

- TypeScript strict, no `any` outside boundaries (always with a `// FIXME` note).
- Filenames: `kebab-case.ts`; components: `PascalCase.tsx`.
- DB tables: `snake_case` plural; columns: `snake_case` singular.
- Brand colors live in CSS variables in `app/globals.css` — never hardcoded in
  components.
- Server Actions return a discriminated `Result<T, E>` — they never throw at
  the client.
- All comments and inline docs in English.

---

## License

Proprietary. Internal Blacknel project.
