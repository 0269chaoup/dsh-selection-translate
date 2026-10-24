/**
 * Browser-half diagnostics.
 *
 * The Web shell installs no console exporter in the packaged build, so a plugin
 * that fails inside `apply` (a rejected `$mount`, a namespace that never lands,
 * a slot that never appears) degrades into a *silent absence* of the feature —
 * there is nothing on screen and nothing in the console to explain it.
 *
 * This module keeps a small, bounded ring of stage records on
 * `globalThis.__selectionTranslateDebug` so the browser half can always be
 * interrogated from a DevTools console after the fact:
 *
 * ```js
 * globalThis.__selectionTranslateDebug            // stage trail, oldest first
 * globalThis.__selectionTranslateDebug.at(-1)     // where it stopped
 * ```
 *
 * Records are best-effort: a frozen or restricted global must never turn a
 * diagnostic into a failure of the feature.
 *
 * @module dsh-selection-translate/client/debug
 */

/** Property the stage trail is published under. */
export const DEBUG_KEY = '__selectionTranslateDebug'

/** Bounded number of records kept; the oldest are dropped first. */
const LIMIT = 200

/** Global surface the trail is installed on. */
interface DebugGlobal {
  [DEBUG_KEY]?: string[]
}

/** Render one detail value without ever throwing. */
function describe(detail: unknown): string {
  if (detail === undefined) return ''
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  try {
    const text = JSON.stringify(detail)
    return text === undefined ? String(detail) : text
  } catch {
    return String(detail)
  }
}

/**
 * Append one stage record, and mirror it to the console when one exists.
 * @param stage - short, stable stage name, e.g. `apply/remote-mounted`.
 * @param detail - optional value; errors and plain objects are stringified.
 */
export function record(stage: string, detail?: unknown): void {
  const extra = describe(detail)
  const line = extra === '' ? stage : `${stage} ${extra}`
  try {
    if (typeof globalThis !== 'undefined') {
      const target = globalThis as DebugGlobal
      const trail = target[DEBUG_KEY] ?? []
      trail.push(line)
      if (trail.length > LIMIT) trail.splice(0, trail.length - LIMIT)
      target[DEBUG_KEY] = trail
    }
    // A packaged shell may leave `console` intact even without a visible sink;
    // when it does, this line survives in DevTools.
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info(`[selection-translate] ${line}`)
    }
  } catch {
    // Diagnostics never break the feature.
  }
}
