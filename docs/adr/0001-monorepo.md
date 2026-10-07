# 0001 — One monorepo with pnpm and Cargo workspaces

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P0-03

## Context

The spec (§12) asks for one monorepo containing the web app, the Rust detection engine, the
`Song` model, heavy importers, the catalogue and a Python pipeline. Contributors should be able to
change the engine and the code that drives it in one pull request.

## Decision

- **pnpm workspaces** for every TypeScript package (`apps/*`, `packages/*`). Packages are consumed
  from source (`"exports"` point at `src/index.ts`); Vite and Vitest compile them, so there is no
  per-package build step for TypeScript.
- **A Cargo workspace** at the root, currently with one member, `packages/engine`. Its
  `package.json` wraps the wasm build so `pnpm build:engine` produces
  `packages/engine/dist/engine.wasm`.
- **Python** in `tools/pipeline` uses only the standard library until a task needs more.
- One root ESLint flat config, one Prettier config, one `tsconfig.base.json`.

## Consequences

- One `pnpm install` and one `cargo build` set up everything.
- Consuming TypeScript from source keeps the inner loop fast but means packages must not rely on
  build-time transforms beyond what Vite and Vitest do.
- The web app needs the engine built first; `pnpm build` runs the engine build before the app.

## Alternatives considered

- **Nx / Turborepo:** caching is useful later but adds tooling for a small project. Revisit when CI
  time hurts.
- **Separate repos:** harder for contributors; engine and worklet would drift.
