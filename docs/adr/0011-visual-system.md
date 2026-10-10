# 0011 — A visual system: tokens, system fonts, one icon set, a calmer practice screen

- **Status:** accepted (approved by the maintainer, 2026-10-09)
- **Date:** 2026-10-08
- **Plan task:** P4-10

## Context

The maintainer found the first interface basic and gimmicky: a wall of same-weight pill buttons in
the practice bar, browser-default sliders and checkboxes, an emoji streak, flat canvas
rectangles. P4-10 asks for a visual system (type, spacing, colour, icons, motion), a refined practice
screen and canvas, and better Home and Library pages.

Constraints that shape the answer:

- Hard rule 5 (no third-party requests at runtime) rules out web fonts and icon fonts from a CDN.
  Hard rule 7 lists the licences that need no discussion; the SIL Open Font Licence is not on it.
- The browser floor is Safari 16.4 (spec §5, where WebAssembly SIMD validates). iPad Safari is the
  main target, so touch targets, ⅓-width Split View and rotation must keep working
  (`e2e/layout.spec.ts`).
- Accessibility settings already exist and must keep working: Large print (root size 125 %), High
  contrast, Reduce motion, left-handed layout.
- The practice canvas runs at 60 fps on an A12-class iPad and is drawn outside React. A canvas
  cannot resolve `var()` or `color-mix()` from a custom property, and the Playwright probe finds the
  expected key by its exact colour.
- Native controls (`<select>`, checkbox, range) give iPad users the system pickers and keep
  Playwright's `selectOption`, `check` and `fill` working.

## Decision

- **Design tokens in one file** (`apps/web/src/styles/tokens.css`): colour, type scale, 4 px
  spacing grid, radii, shadows, motion, in four colour sets (light, dark, high contrast in each).
  The other stylesheets only refer to token names. `test/tokens.test.ts` parses the file and checks
  the contrast of every text pair (4.5:1) and every mark (3:1) in all four sets, so a palette change
  that hurts readability fails in CI.
- **Colours stay plain `#rrggbb` / `rgba()` values**, so the canvas can read them with
  `getComputedStyle`. The renderer derives glows and edges from them once per resize
  (`views/colour.ts`).
- **System fonts only** (SF Pro on Apple devices, Segoe UI, Roboto elsewhere). Nothing is
  downloaded; no font licence needs a decision.
- **Native controls, restyled in CSS**: a raised-thumb segmented control, tinted (not filled)
  toggles, 8 px corners instead of pills, a custom slider, checkbox and switch.
- **Icons: `lucide-react`** (ISC, on the allowed list), drawn at the size of the text beside them
  through one provider (`LucideProvider`, `.icon { width: 1.15em }`), so Large print scales them.
  Icons are decorative (`aria-hidden`); buttons keep their text names.
- **Palette:** neutrals with a hint of the logo's teal, the logo teal itself as the accent, cobalt
  and copper for the two hands (a pair that stays apart for colour-blind learners), and an
  `--on-hand` token for marks drawn on a hand colour.
- **Practice screen:** the global navigation gives way to a slim session header (back, title, MIDI
  and microphone, Options); controls are three quiet rows (mode / hands / metronome, loop, tempo;
  run status and view). Keyboard size and fingers moved into an Options panel, a plain disclosure
  button with `aria-expanded` (`ui/Popover.tsx`), because they are set once. Below 640 px (or 520 px
  high) secondary buttons keep their icon only; their names stay for screen readers.
- **Canvas:** notes are tiles with an outline and a lit leading edge, bars are numbered, the lanes of
  the black keys are shaded, the keyboard has a shadow under its top edge and glossy black keys, finger
  numbers are large, and a played key blooms for 0.35 s (off under Reduce motion). Gradients are
  built once per size, there is no `shadowBlur`, and the font is set only when it changes. It is
  built to stay cheap, but frame time on an A12-class iPad has not been measured yet.

## Consequences

- Changing the look is a token edit; the contrast test says at once whether it is still readable.
- One more dependency (`lucide-react`, ISC, tree-shaken to the icons used).
- The e2e suite is the contract for the markup: accessible names, `.stats`, `.card` and a few
  classes. Moving a control into a panel (as with Options) means the specs open the panel first.
- The system font differs by platform, so line breaks differ a little between iPad, Windows and
  Android.
- Not done here: a manual light/dark switch (the app follows the system), a refreshed logo, and
  German strings (P2-14).

## Alternatives considered

- **A web font such as Inter** (SIL OFL). Consistent across platforms, but not on the licence list
  (a maintainer decision) and an extra download; the system font looks right on the target iPad.
- **A component library or CSS framework** (Radix, Tailwind). More dependencies and build tooling
  for a small number of controls; native elements already behave correctly.
- **Our own SVG icon set.** No dependency, but drawing and maintaining twenty good icons is not
  where the effort belongs.
- **The HTML `popover` attribute and CSS anchor positioning.** Newer than the Safari floor.
- **`color-mix()` or `oklch()` colour tokens.** Fine for CSS but unreadable to the canvas and to
  the pixel probe.
- **`shadowBlur` glows and per-note gradients on the canvas.** Pretty, but costly on an iPad.
