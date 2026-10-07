# 0004 — Practice logic lives in its own DOM-free package

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P1-08

## Context

The spec's repository layout (§12) has no home for the practice engine (steps, wait mode,
play-along scoring). Putting it inside `apps/web` would make it easy to mix timing logic with React
state and browser APIs, and harder to reuse from the iOS shell or test in Node.

## Decision

Add `packages/practice`. It depends only on `packages/song-model`, has no DOM, React, Web Audio or
storage dependencies, and is driven entirely by `NoteEvent`s and times passed in by the caller.

## Consequences

- Wait mode and scoring are unit-tested in Node with exact timings.
- The web app owns the clock (`AudioContext.currentTime`) and passes times in.

## Alternatives considered

- **`apps/web/src/practice`:** fewer packages, but weaker boundaries.
- **Inside `packages/song-model`:** mixes data model and behaviour.
