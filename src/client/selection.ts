/**
 * Selection detection for the floating translate button.
 *
 * DSH exposes no selection API: a plugin that wants a selection affordance is
 * ordinary browser code and owns its own DOM listeners. This module is that
 * logic, kept free of React so it can be reasoned about (and unit tested)
 * separately from rendering.
 *
 * The button must not appear for every selection in the page. A selection inside
 * an editor, a code block, or a terminal belongs to that surface, where a
 * translate popup would either fight its own keyboard handling or steal a
 * copy gesture.
 *
 * @module dsh-selection-translate/client/selection
 */

/** Gap between the selection and the button, and between the button and the card. */
const GAP = 8

/** Rendered height of the floating button. */
const BUTTON_HEIGHT = 32

/**
 * Worst-case rendered width of the floating button, used only to keep it inside
 * the viewport. The real width depends on the label ("翻译" is narrower than
 * "Translate"), so this is deliberately the wider of the two.
 */
const BUTTON_WIDTH = 104

/** Preferred card width; the card shrinks to the viewport on narrow layouts. */
const CARD_WIDTH = 400

/** Minimum card height worth showing. */
const CARD_MIN_HEIGHT = 140

/** Distance kept from every viewport edge. */
const EDGE = 8

/**
 * Surfaces whose selections are never translated.
 *
 * - `input`/`textarea`/`contenteditable`/`[role="textbox"]`: the chat composer and any inline editor;
 * - `pre`, plus the block-level code wrappers DSH renders (`[data-dsh-code-block]`,
 *   `.shiki`): a code block, where the reader wants the snippet, not a
 *   translation of it;
 * - `.xterm*`/`[data-dsh-terminal]`: the terminal pane, whose own selection model is separate;
 * - `[data-dsh-selection-translate="off"]`: any surface that opts out explicitly, including this plugin's own card.
 *
 * Inline `code` / `kbd` / `samp` are *not* excluded. A token in the middle of a
 * sentence is part of the prose — "the `translateStream` endpoint yields text
 * deltas" is exactly the kind of sentence a reader wants translated — and
 * because the detector looks at both ends of the selection, excluding the token
 * also killed every sentence that merely *started* or *ended* on one. Fenced
 * blocks stay excluded through their `pre` container.
 */
export const EXCLUDED_SELECTOR = [
  'input',
  'textarea',
  'select',
  'pre',
  '[data-dsh-code-block]',
  '.shiki',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '.xterm',
  '.xterm-screen',
  '.xterm-rows',
  '[data-dsh-terminal]',
  '[data-dsh-selection-translate="off"]',
].join(',')

/** Viewport geometry of one detected selection. */
export interface SelectionAnchor {
  /** Exact text snapshot taken at detection time. */
  readonly text: string
  /** Viewport coordinates of the floating button. */
  readonly buttonTop: number
  readonly buttonLeft: number
  /**
   * Edge of the button that faces the selection: the pointer is drawn there, so
   * a button pushed below the selection points up and a flipped one points down.
   */
  readonly pointer: 'top' | 'bottom'
  /** Horizontal offset of the pointer inside the button, in pixels. */
  readonly pointerLeft: number
  /** Viewport coordinates and size of the result card. */
  readonly cardTop: number
  readonly cardLeft: number
  readonly cardWidth: number
  readonly cardMaxHeight: number
}

/** Whether both the anchor and focus of a selection sit outside the excluded surfaces. */
function insideExcludedSurface(selection: Selection): boolean {
  const nodes = [selection.anchorNode, selection.focusNode]
  for (const node of nodes) {
    const element = node instanceof Element ? node : node?.parentElement ?? null
    if (element === null) continue
    if (element.closest(EXCLUDED_SELECTOR) !== null) return true
  }
  return false
}

/** Clamp a number into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** First usable client rect of a range, in viewport coordinates. */
function rangeRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null
  if (rects !== null && rects.length > 0) {
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index]
      if (rect.width > 0 || rect.height > 0) return rect
    }
  }
  const bounding = range.getBoundingClientRect()
  return bounding.width > 0 || bounding.height > 0 ? bounding : null
}

/**
 * Read the current selection and compute where the affordance belongs.
 *
 * Returns nothing — rather than a malformed anchor — in every case the feature
 * should stay hidden: no selection, whitespace only, a selection too short for
 * `minChars`, a selection in an excluded surface, or a zero-size range (an
 * empty line, a collapsed range in a hidden subtree).
 * @param minChars - shortest accepted selection in UTF-16 code units.
 * @returns the anchor, or null when no button should appear.
 */
export function readSelectionAnchor(minChars: number): SelectionAnchor | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
  const text = selection.toString()
  if (text.trim().length === 0) return null
  if (text.trim().length < Math.max(1, minChars)) return null
  if (insideExcludedSurface(selection)) return null

  let rect: DOMRect | null = null
  try {
    rect = rangeRect(selection.getRangeAt(0))
  } catch {
    return null
  }
  if (rect === null) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const cardWidth = Math.min(CARD_WIDTH, Math.max(200, viewportWidth - EDGE * 2))

  // Below the selection by default; flip above when the selection sits near the
  // bottom edge, which is the normal case for the last message in a long chat.
  let buttonTop = rect.bottom + GAP
  let pointer: 'top' | 'bottom' = 'top'
  if (buttonTop + BUTTON_HEIGHT > viewportHeight - EDGE) {
    buttonTop = Math.max(EDGE, rect.top - GAP - BUTTON_HEIGHT)
    pointer = 'bottom'
  }
  const selectionCenter = rect.left + rect.width / 2
  const buttonLeft = clamp(
    selectionCenter - BUTTON_WIDTH / 2,
    EDGE,
    Math.max(EDGE, viewportWidth - BUTTON_WIDTH - EDGE),
  )
  // The pointer tracks the selection centre inside the button, clamped so it can
  // never leave the rounded corner it belongs to.
  const pointerLeft = clamp(selectionCenter - buttonLeft - 4, 10, BUTTON_WIDTH - 18)

  const cardTop = clamp(buttonTop + BUTTON_HEIGHT + GAP, EDGE, Math.max(EDGE, viewportHeight - CARD_MIN_HEIGHT - EDGE))
  const cardLeft = clamp(rect.left, EDGE, Math.max(EDGE, viewportWidth - cardWidth - EDGE))
  const cardMaxHeight = Math.max(CARD_MIN_HEIGHT, viewportHeight - cardTop - EDGE)

  return { text, buttonTop, buttonLeft, pointer, pointerLeft, cardTop, cardLeft, cardWidth, cardMaxHeight }
}

/**
 * Whether a node belongs to this plugin's own overlay.
 * @param node - event target or selection node.
 * @returns true when the node is inside the overlay root.
 */
export function insideOverlay(node: Node | null): boolean {
  if (node === null) return false
  const element = node instanceof Element ? node : node.parentElement
  if (element === null) return false
  return element.closest('[data-dsh-selection-translate]') !== null
}
