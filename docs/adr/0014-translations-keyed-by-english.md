# 0014 — Translations keyed by the English text

- **Status:** proposed
- **Date:** 2026-10-09
- **Plan task:** P2-14

## Context

The app needs German as well as English (spec §5, P2-14), for about 430 strings across the screens,
the canvas labels and the messages the shared packages throw on import. The packages must stay pure
(no DOM, no React, AGENTS.md), and the canvas and session code run outside React.

## Decision

- `apps/web/src/i18n/index.ts` has one function, `t(text, vars)`. The **English text is the key**;
  `i18n/de.ts` maps it to German. Without a German entry the English shows, never a blank or a key.
  `{name}` placeholders are filled from `vars`. Plurals are separate keys chosen in code
  (`'1 piece found'`, `'{n} pieces found'`).
- The language is an app setting (`language: 'en' | 'de'`). A first visit follows the browser's
  language; after that the saved choice wins. Changing it re-keys the React tree, so every `t()` call
  re-runs; `<html lang>` and the document title follow.
- Import errors and warnings from `packages/song-model`, `packages/importers` and
  `packages/audio-import` stay English in the packages; the app shows them with `t(message)`.
- `test/i18n.test.ts` scans the source for `t('…')` literals and the packages for `ImportError` and
  warning literals, and fails on a missing German entry, mismatched placeholders or an unused entry.
- Long prose pages (About, the privacy policy, the Impressum) have a German version written as its
  own component instead of sentence fragments, so the German reads naturally.
- German note names follow German usage on the falling notes: H for B, B for B♭, Fis, Es.

## Consequences

- Changing an English string means changing its German key too; the test points at both.
- No dependency was added (no i18next or ICU message format). Plural rules beyond one/many and
  gendered forms are written out by hand, which is enough for English and German.
- Adding a third language means a second dictionary and a `Lang` value.

## Alternatives considered

- **Symbolic keys (`home.hero.title`)**: stable when English wording changes, but every string needs
  a name and the English source is no longer readable in the components.
- **i18next or FormatJS**: more features (ICU plurals, lazy loading) than two languages need, and a
  new runtime dependency in the main bundle.
