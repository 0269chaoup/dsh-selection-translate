/**
 * Clipboard helper shared by the card and the configuration panel.
 *
 * @module dsh-selection-translate/client/clipboard
 */

/**
 * Copy text, falling back to a hidden textarea where the Clipboard API is
 * unavailable (an insecure origin, or a permission the page never granted).
 * @param value - text to copy.
 * @returns whether the copy succeeded.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
