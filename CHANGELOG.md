# Changelog

All notable changes to `dsh-selection-translate`. Versions before 0.3.0 were
never logged; this file starts here.

## 0.3.0 — 2026-10-24

### Added — streaming translation

- **`selectionTranslate/translateStream`**, a fifth Remote endpoint declared
  `@Remote({ mode: 'stream' })`. It yields `{ kind: 'delta', text }` items while
  the model writes and one terminal `{ kind: 'done', result }` carrying exactly
  what the unary endpoint returns.
- The card renders that stream: skeleton bars until the first byte, then text
  with a blinking caret and a Cancel control. It follows the bottom only while
  the reader is already there, so scrolling up mid-answer is not undone.
- A cache hit and an already-running call both stream as one delta plus the
  terminal item, so an instant answer needs no second render path.
- Cancellation is checked per provider chunk, not only after the loop: Esc or a
  new selection closes the Host generator, and an abandoned answer is never
  cached.
- The browser **feature-detects** the endpoint and falls back to the unary
  `translate` call when it is missing or fails before its first delta, so a Host
  without stream support degrades to the previous behaviour instead of a broken
  card.
- `TranslateEvent` published as a wire type; the Host manifest documents
  `translateStream` with its signature, summary, and type declaration.

### Changed — UI redesign

- Card rebuilt around one reading size: the translation is 14.5px/1.75 on a
  recessed `bg-layer-1` surface inside a `bg-layer-2` shell, the title dropped to
  12.5px, and every metadata line to 11px `label-tertiary` with tabular numerals.
- The floating trigger became a 32px chip: a 20px accent letter tile
  (`文` / `A`), the label, and a pointer aimed at the selection centre that flips
  side when the button is placed above the selection.
- Metadata row: a green cached badge, a divider, the model in mono, the
  `chars → length` pair. Copy now confirms in place (check mark for 1.6s) and is
  announced through an `aria-live` region.
- Settings form regrouped into Basics / Language & style / Advanced over one
  96px-label grid; the master switch owns a full-width row; the effective route
  is a pill; the prompt preview became two labelled code blocks with their own
  copy buttons.
- Motion is a single easing curve over 110–180ms and collapses under
  `prefers-reduced-motion`.

### Fixed

- **Inline code is translatable again.** `code`, `kbd` and `samp` left the
  exclusion list: a token inside a sentence belongs to the prose, and because
  the detector looks at both ends of a selection, excluding the token also
  suppressed every sentence that merely started or ended on one. Fenced blocks
  stay excluded through `pre`, plus `[data-dsh-code-block]` / `.shiki` for
  renderers that do not use a `pre`.
- Light theme: `bg-layer-3` is pure white there, so skeleton bars, the switch
  track, the route pill and the prompt-block headers were invisible. They now use
  a theme-neutral `label-primary` tint.
- The primary button and the switch knob referenced `--dsw-alias-label-on-fill`,
  a token that does not exist in DSH. They use `--dsw-alias-label-primary-inverted`.
- Contrast now meets AA in **both** themes against the real host palette: quiet
  ink 5.34/7.79, success 5.82/8.53, error 5.77/4.95, primary fill 5.09/5.78
  (light/dark). The host's raw green is 2.28:1 on a light card, so status inks are
  mixed towards `label-primary` instead of used at full strength.
- Card and trigger shadows are re-weighted for the dark theme through the host's
  own `body[data-ds-dark-theme]` marker instead of one weight for both.

### Known limits

- The logical-stream carrier has not been iterated inside a real browser here.
  The shell bundle ships it (`RemoteStreamHandle`, `item`/`end`/`error` frames,
  `dispose()` → `cancel`), the real loader registers the fifth descriptor, and
  `pnpm run smoke` drives the Host generator directly — but no browser has
  watched one. The unary fallback is what covers that gap.
- Light and dark themes were verified by rendering the real components against
  the host's real token values, not by clicking through the live GUI.
