/**
 * Styles of the selection popup and the result card.
 *
 * Written as one plain stylesheet string instead of CSS modules: the Client
 * bundle is produced by a single esbuild pass, and a stylesheet that the
 * component renders as an element disappears with the component, which is the
 * disposal behaviour the Client authoring rules ask for.
 *
 * Every colour is a host theme token (`--dsw-alias-*`) with a literal fallback,
 * so a renamed token degrades appearance rather than breaking the card, and
 * nothing is hard-coded to a light-only palette.
 *
 * Layout language (the OpenDesign redesign): hierarchy comes from lightness and
 * type scale rather than from stacked borders — the card is one `bg-layer-2`
 * shell around a recessed `bg-layer-1` reading area, the translation is the
 * only element at reading size (14.5px/1.75), and every metadata line drops to
 * 11px `label-tertiary`. Motion is one easing curve over 110–180ms and
 * collapses under reduced motion.
 *
 * @module dsh-selection-translate/client/styles
 */

/** Prefix shared by every class name this plugin owns. */
export const STYLE_ELEMENT_ATTRIBUTE = 'data-dsh-selection-translate-style'

/** Marker attribute set on the overlay root; the selection detector ignores text inside it. */
export const OVERLAY_ATTRIBUTE = 'data-dsh-selection-translate'

/** The whole stylesheet. */
export const STYLES = `
.dsh-st-layer {
  /* Plugin-side aliases derived from the host tokens; every one of them
     resolves to a host token, so a theme switch needs no rule change here. */
  --dsh-st-ease: cubic-bezier(.2, .8, .3, 1);
  --dsh-st-radius-card: 12px;
  --dsh-st-radius-field: 6px;
  /* Light is the default weight; the host marks its own dark theme on <body>,
     which is the only theme signal a third-party stylesheet gets. */
  --dsh-st-shadow-card: 0 1px 2px rgba(0, 0, 0, .08), 0 12px 28px -12px rgba(0, 0, 0, .24);
  --dsh-st-shadow-trigger: 0 1px 2px rgba(0, 0, 0, .10), 0 6px 16px -8px rgba(0, 0, 0, .22);
  /* Literal tints first: an engine without \`color-mix()\` keeps a usable card,
     and the mix below only refines those tints against the live accent. */
  --dsh-st-accent-soft: rgba(77, 141, 250, .16);
  --dsh-st-accent-line: rgba(77, 141, 250, .34);
  --dsh-st-error-soft: rgba(242, 85, 90, .12);
  --dsh-st-error-line: rgba(242, 85, 90, .30);
  /* Ink and fill roles whose host token is a raw accent: at full strength the
     host green is 2.3:1 and the host red 4.2:1 on a light card, so each is
     mixed towards \`label-primary\` — the most contrasting ink of whichever
     theme is live. One rule, both themes inside AA. */
  --dsh-st-ink-quiet: var(--dsw-alias-label-tertiary, #adb2b8);
  --dsh-st-ok-ink: var(--dsw-alias-state-success-primary, #22c55e);
  --dsh-st-error-ink: var(--dsw-alias-state-error-primary, #f25a5a);
  --dsh-st-biz-fill: var(--dsw-alias-state-business-primary, #4d8dfa);
  --dsh-st-fill-quiet: rgba(128, 128, 128, .22);
  --dsh-st-on-accent: var(--dsw-alias-label-primary-inverted, #0a0c10);

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  color: var(--dsw-alias-label-primary, #e8eaed);
  font: 400 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
}

/* ------------------------------------------------------------------ trigger */

@supports (color: color-mix(in srgb, red, blue)) {
  .dsh-st-layer {
    --dsh-st-accent-soft: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d8dfa) 16%, transparent);
    --dsh-st-accent-line: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d8dfa) 34%, transparent);
    --dsh-st-error-soft: color-mix(in srgb, var(--dsw-alias-state-error-primary, #f2555a) 12%, transparent);
    --dsh-st-error-line: color-mix(in srgb, var(--dsw-alias-state-error-primary, #f2555a) 30%, transparent);
    --dsh-st-ink-quiet: color-mix(in srgb,
      var(--dsw-alias-label-tertiary, #adb2b8) 78%,
      var(--dsw-alias-label-primary, #0f1115));
    --dsh-st-ok-ink: color-mix(in srgb,
      var(--dsw-alias-state-success-primary, #22c55e) 55%,
      var(--dsw-alias-label-primary, #0f1115));
    --dsh-st-error-ink: color-mix(in srgb,
      var(--dsw-alias-state-error-primary, #f25a5a) 85%,
      var(--dsw-alias-label-primary, #0f1115));
    --dsh-st-biz-fill: color-mix(in srgb,
      var(--dsw-alias-state-business-primary, #4d8dfa) 88%,
      var(--dsw-alias-label-primary, #0f1115));
    --dsh-st-fill-quiet: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 10%, transparent);
  }
}

body[data-ds-dark-theme] .dsh-st-layer {
  --dsh-st-shadow-card: 0 2px 4px rgba(0, 0, 0, .32), 0 14px 32px -10px rgba(0, 0, 0, .62);
  --dsh-st-shadow-trigger: 0 1px 2px rgba(0, 0, 0, .45), 0 6px 16px -6px rgba(0, 0, 0, .60);
}

.dsh-st-button {
  position: fixed;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 5px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-2, #1b1e23));
  color: var(--dsw-alias-label-primary, #e8eaed);
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  box-shadow: var(--dsh-st-shadow-trigger);
  user-select: none;
  -webkit-user-select: none;
  animation: dsh-st-fade-in 140ms var(--dsh-st-ease);
  transition: background 160ms var(--dsh-st-ease), border-color 160ms var(--dsh-st-ease),
              transform 160ms var(--dsh-st-ease), box-shadow 160ms var(--dsh-st-ease);
}
.dsh-st-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3, #22262c));
  border-color: var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
  transform: translateY(-1px);
}
.dsh-st-button:active {
  transform: scale(.985);
}
.dsh-st-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d8dfa);
  outline-offset: 2px;
}
/* The 20px mark replaces the old 「A→文」 placeholder: a quiet accent tile that
   reads as an icon at a glance and as a letter tile at reading distance. */
.dsh-st-button-mark {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding-bottom: 1px;
  border-radius: 6px;
  border: 1px solid var(--dsh-st-accent-line);
  background: var(--dsh-st-accent-soft);
  color: var(--dsw-alias-state-business-primary, #4d8dfa);
  font: 600 11.5px/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
.dsh-st-button-label {
  white-space: nowrap;
}
/* Pointer towards the selection; the edge it sits on depends on which side of
   the selection the button was placed. */
.dsh-st-button-pointer {
  position: absolute;
  left: 17px;
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-2, #1b1e23));
  pointer-events: none;
  transition: background 160ms var(--dsh-st-ease);
}
.dsh-st-button-pointer[data-side="top"] {
  top: -4.5px;
  border-left: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  border-top-left-radius: 1px;
}
.dsh-st-button-pointer[data-side="bottom"] {
  bottom: -4.5px;
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  border-bottom-right-radius: 1px;
}
.dsh-st-button:hover .dsh-st-button-pointer {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3, #22262c));
}

/* --------------------------------------------------------------------- card */

.dsh-st-card {
  position: fixed;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  max-width: min(440px, calc(100vw - 16px));
  border-radius: var(--dsh-st-radius-card);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.32));
  background: var(--dsw-alias-bg-layer-2, #1b1e23);
  box-shadow: var(--dsh-st-shadow-card);
  overflow: hidden;
  animation: dsh-st-pop-in 160ms var(--dsh-st-ease);
}

.dsh-st-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 8px 8px 13px;
  background: var(--dsw-alias-bg-layer-2, #1b1e23);
}
.dsh-st-head-text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.dsh-st-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .09em;
  color: var(--dsh-st-ink-quiet);
}
.dsh-st-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-title-muted {
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #a8adb8);
}
.dsh-st-title-error {
  color: var(--dsh-st-error-ink);
}
.dsh-st-acts {
  display: flex;
  flex: none;
  align-items: center;
  gap: 1px;
  margin-left: auto;
}
.dsh-st-iconbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #7c828e);
  font: inherit;
  cursor: pointer;
  transition: background 150ms var(--dsh-st-ease), color 150ms var(--dsh-st-ease),
              transform 120ms var(--dsh-st-ease);
}
.dsh-st-iconbtn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-iconbtn:active {
  transform: scale(.94);
}
.dsh-st-iconbtn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d8dfa);
  outline-offset: 1px;
}
.dsh-st-iconbtn[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-iconbtn-ok,
.dsh-st-iconbtn-ok:hover {
  color: var(--dsh-st-ok-ink);
}

/* The reading area: one recessed surface framed by two hairlines instead of a
   third background level. */
.dsh-st-body {
  background: var(--dsw-alias-bg-layer-1, #15171b);
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
}
.dsh-st-scrollwrap {
  position: relative;
}
/* Edge fades are the scroll affordance: each side only appears while it still
   hides content, so a short answer shows no fade at all. */
.dsh-st-scrollwrap::before,
.dsh-st-scrollwrap::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 22px;
  pointer-events: none;
  opacity: 1;
  transition: opacity 180ms var(--dsh-st-ease);
}
.dsh-st-scrollwrap::before {
  top: 0;
  background: linear-gradient(to bottom, var(--dsw-alias-bg-layer-1, #15171b), transparent);
}
.dsh-st-scrollwrap::after {
  bottom: 0;
  background: linear-gradient(to top, var(--dsw-alias-bg-layer-1, #15171b), transparent);
}
.dsh-st-scrollwrap[data-at-top="true"]::before {
  opacity: 0;
}
.dsh-st-scrollwrap[data-at-bottom="true"]::after {
  opacity: 0;
}
.dsh-st-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 13px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5)) transparent;
}
.dsh-st-scroll::-webkit-scrollbar {
  width: 8px;
}
.dsh-st-scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 4px;
  background: var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
  background-clip: content-box;
}
/* Reading size: the translation is the only thing on the card that gets it. */
.dsh-st-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary, #e8eaed);
  font-size: 14.5px;
  line-height: 1.75;
}
/* The stream caret: a 2px accent bar that says "a model is still writing",
   which the skeleton bars stop saying the moment the first delta lands. */
.dsh-st-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -.16em;
  background: var(--dsw-alias-state-business-primary, #4d8dfa);
  animation: dsh-st-blink 1s steps(2, start) infinite;
}
@keyframes dsh-st-blink {
  50% { opacity: 0; }
}

.dsh-st-text-muted {
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-size: 12.5px;
  line-height: 1.7;
}

/* ------------------------------------------------------- loading / skeleton */

.dsh-st-skel {
  display: grid;
  gap: 9px;
  padding: 2px 0 4px;
}
.dsh-st-skel span {
  display: block;
  height: 10px;
  border-radius: 4px;
  background: var(--dsh-st-fill-quiet);
  animation: dsh-st-pulse 1.3s var(--dsh-st-ease) infinite;
}
.dsh-st-skel span:nth-child(1) {
  width: 100%;
}
.dsh-st-skel span:nth-child(2) {
  width: 92%;
  animation-delay: 90ms;
}
.dsh-st-skel span:nth-child(3) {
  width: 64%;
  animation-delay: 180ms;
}
@keyframes dsh-st-pulse {
  0%, 100% { opacity: .45; }
  50% { opacity: 1; }
}
.dsh-st-loadingbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 0 1px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #a8adb8);
}
.dsh-st-spinner {
  display: inline-block;
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
  border-top-color: var(--dsw-alias-state-business-primary, #4d8dfa);
  animation: dsh-st-spin 900ms linear infinite;
}
@keyframes dsh-st-spin {
  to { transform: rotate(360deg); }
}

/* -------------------------------------------------------------------- error */

.dsh-st-error {
  display: grid;
  gap: 9px;
}
.dsh-st-error-head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--dsh-st-error-ink);
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
}
.dsh-st-error-detail {
  padding: 7px 9px;
  border-radius: var(--dsh-st-radius-field);
  border: 1px solid var(--dsh-st-error-line);
  background: var(--dsh-st-error-soft);
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-size: 11.5px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.dsh-st-error-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ------------------------------------------------------------------ buttons */

.dsh-st-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--dsh-st-radius-field);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background 150ms var(--dsh-st-ease), border-color 150ms var(--dsh-st-ease),
              color 150ms var(--dsh-st-ease), transform 120ms var(--dsh-st-ease);
}
.dsh-st-btn:active {
  transform: scale(.98);
}
.dsh-st-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d8dfa);
  outline-offset: 1px;
}
.dsh-st-btn:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.dsh-st-btn-primary {
  background: var(--dsh-st-biz-fill);
  color: var(--dsh-st-on-accent);
}
.dsh-st-btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.dsh-st-btn-secondary {
  border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  background: var(--dsw-alias-bg-layer-1, #15171b);
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-btn-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
  border-color: var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
}
.dsh-st-btn-ghost {
  height: 26px;
  padding: 0 8px;
}
.dsh-st-btn-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-btn-sm {
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}

/* --------------------------------------------------------------------- meta */

.dsh-st-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 6px 13px;
  color: var(--dsh-st-ink-quiet);
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.dsh-st-foot-cache {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--dsh-st-ok-ink);
}
.dsh-st-foot-div {
  flex: none;
  width: 1px;
  height: 10px;
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
}
.dsh-st-foot-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
}
.dsh-st-foot-counts {
  flex: none;
  margin-left: auto;
  white-space: nowrap;
}

/* Screen-reader-only live region: copy and state changes are announced without
   adding visible chrome to a card this small. */
.dsh-st-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* A card with the settings form open needs its own scroll region: the form is
   taller than a translation and must not be clipped by the result height. */
.dsh-st-card-settings {
  max-height: min(560px, calc(100vh - 24px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* ----------------------------------------------------------------- settings */

.dsh-st-settings {
  display: flex;
  flex-direction: column;
  padding: 2px 12px 12px;
  background: var(--dsw-alias-bg-layer-2, #1b1e23);
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-size: 12px;
}
.dsh-st-settings-note {
  margin: 4px 0 8px;
  padding: 7px 9px;
  border-radius: var(--dsh-st-radius-field);
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, #15171b);
  color: var(--dsw-alias-label-tertiary, #7c828e);
  font-size: 11px;
  line-height: 1.55;
}

/* The master switch gets its own full-width row: a label column would push a
   34px control into a 96px indent and lose the reading order. */
.dsh-st-settings-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0 13px;
}
.dsh-st-settings-toggle-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.dsh-st-settings-toggle-title {
  color: var(--dsw-alias-label-primary, #e8eaed);
  font-size: 12.5px;
  font-weight: 550;
}
.dsh-st-settings-toggle-desc {
  color: var(--dsh-st-ink-quiet);
  font-size: 11px;
  line-height: 1.55;
}

.dsh-st-settings-group {
  display: grid;
  gap: 11px;
  padding: 13px 0;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
}
.dsh-st-settings-group-title {
  color: var(--dsh-st-ink-quiet);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .1em;
}
.dsh-st-settings-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.dsh-st-settings-label {
  padding-top: 5px;
  text-align: right;
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}
.dsh-st-settings-controls {
  display: grid;
  gap: 5px;
  min-width: 0;
}
/* An input plus its own hint or error line, so a message sits directly under the
   control it explains instead of drifting to the end of the row. */
.dsh-st-settings-field {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.dsh-st-settings-field-hint {
  color: var(--dsh-st-ink-quiet);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.dsh-st-settings-field-error {
  color: var(--dsh-st-error-ink);
  font-size: 11px;
  line-height: 1.5;
}
.dsh-st-settings-select,
.dsh-st-settings-input,
.dsh-st-settings-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0 9px;
  border-radius: var(--dsh-st-radius-field);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.36));
  background: var(--dsw-alias-bg-layer-1, #15171b);
  color: var(--dsw-alias-label-primary, #e8eaed);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  transition: border-color 150ms var(--dsh-st-ease), background 150ms var(--dsh-st-ease);
}
.dsh-st-settings-select,
.dsh-st-settings-input {
  height: 30px;
}
.dsh-st-settings-select {
  cursor: pointer;
}
.dsh-st-settings-textarea {
  min-height: 62px;
  padding: 7px 9px;
  line-height: 1.65;
  resize: vertical;
}
.dsh-st-settings-select:hover,
.dsh-st-settings-input:hover,
.dsh-st-settings-textarea:hover {
  border-color: var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
}
.dsh-st-settings-select:focus-visible,
.dsh-st-settings-input:focus-visible,
.dsh-st-settings-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d8dfa);
  outline-offset: 1px;
  border-color: var(--dsw-alias-state-business-primary, #4d8dfa);
}
.dsh-st-settings-input::placeholder,
.dsh-st-settings-textarea::placeholder {
  color: var(--dsw-alias-label-tertiary, #7c828e);
}
.dsh-st-settings-select:disabled,
.dsh-st-settings-input:disabled,
.dsh-st-settings-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.dsh-st-settings-input-invalid {
  border-color: var(--dsh-st-error-ink);
}
.dsh-st-settings-numrow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dsh-st-settings-num {
  width: 84px;
  font-variant-numeric: tabular-nums;
}
.dsh-st-settings-unit {
  color: var(--dsh-st-ink-quiet);
  font-size: 11px;
}
/* The resolved route, shown as a pill so an empty override still answers
   "which model runs right now". */
.dsh-st-settings-route {
  display: inline-flex;
  align-items: center;
  align-self: start;
  gap: 5px;
  padding: 1px 8px 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
  background: var(--dsh-st-fill-quiet);
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  white-space: nowrap;
}
.dsh-st-settings-route i {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #3fbf7f);
}

.dsh-st-settings-switch {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(140, 140, 140, 0.5));
  background: var(--dsh-st-fill-quiet);
  cursor: pointer;
  transition: background 160ms var(--dsh-st-ease), border-color 160ms var(--dsh-st-ease);
}
.dsh-st-settings-switch[aria-checked="true"] {
  border-color: transparent;
  background: var(--dsh-st-biz-fill);
}
.dsh-st-settings-switch:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-st-settings-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d8dfa);
  outline-offset: 2px;
}
.dsh-st-settings-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsh-st-ink-quiet);
  transition: transform 160ms var(--dsh-st-ease), background 160ms var(--dsh-st-ease);
}
.dsh-st-settings-switch[aria-checked="true"] .dsh-st-settings-knob {
  transform: translateX(14px);
  background: var(--dsh-st-on-accent);
}

.dsh-st-settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}
.dsh-st-settings-status {
  margin-left: auto;
  color: var(--dsh-st-ink-quiet);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.dsh-st-settings-status-ok {
  color: var(--dsh-st-ok-ink);
}
.dsh-st-settings-status-error {
  color: var(--dsh-st-error-ink);
}

/* Prompt preview: a disclosure holding two labelled code blocks, each with its
   own copy control. */
.dsh-st-settings-preview {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
}
.dsh-st-settings-preview-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 0;
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  list-style: none;
}
.dsh-st-settings-preview-head::-webkit-details-marker {
  display: none;
}
.dsh-st-settings-preview-head:hover {
  color: var(--dsw-alias-label-primary, #e8eaed);
}
.dsh-st-settings-preview-body {
  display: grid;
  gap: 8px;
  margin-top: 9px;
}
.dsh-st-settings-preview-block {
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, #15171b);
}
.dsh-st-settings-preview-blockhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
  background: var(--dsh-st-fill-quiet);
}
.dsh-st-settings-preview-tag {
  color: var(--dsh-st-ink-quiet);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: .08em;
}
.dsh-st-settings-preview-blockhead .dsh-st-btn {
  margin-left: auto;
}
.dsh-st-settings-pre {
  margin: 0;
  padding: 9px 10px;
  max-height: 180px;
  overflow: auto;
  color: var(--dsw-alias-label-secondary, #a8adb8);
  font: 400 11px/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* -------------------------------------------------------- row settings page */

.dsh-st-settings-page {
  display: block;
  max-width: 640px;
  color: var(--dsw-alias-label-primary, #e8eaed);
  font: 400 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
}
.dsh-st-settings-page .dsh-st-settings {
  padding: 0;
  background: transparent;
}
.dsh-st-settings-page .dsh-st-settings-toggle {
  padding-top: 0;
}
.dsh-st-settings-page-title {
  margin: 0 0 10px;
  color: var(--dsw-alias-label-primary, #e8eaed);
  font-size: 13px;
  font-weight: 600;
}

/* ------------------------------------------------------------------- motion */

@keyframes dsh-st-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dsh-st-pop-in {
  from { opacity: 0; transform: translateY(4px) scale(.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-st-layer *,
  .dsh-st-layer *::before,
  .dsh-st-layer *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  .dsh-st-button:hover {
    transform: none;
  }
}
`
