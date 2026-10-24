/**
 * Browser-side language resolution.
 *
 * The Host accepts an already-resolved destination tag, so the page decides
 * what `auto` means: the interface language the user is reading the GUI in.
 * Both the overlay and the configuration panel need that answer, which is why
 * it lives here instead of inside one component.
 *
 * @module dsh-selection-translate/client/language
 */

/** The page's own language tag, normalized to BCP 47. */
export function interfaceLanguage(): string {
  const fromDocument = typeof document === 'undefined' ? '' : document.documentElement.lang
  const fromNavigator = typeof navigator === 'undefined' ? '' : navigator.language
  const tag = fromDocument || fromNavigator || 'en'
  return tag.replace('_', '-')
}

/**
 * Resolve the destination language from a configured value.
 * @param configured - the configured `targetLanguage`; `auto` follows the interface language.
 * @returns a BCP 47 tag to send with the request.
 */
export function destinationLanguage(configured: string): string {
  const trimmed = configured.trim()
  if (trimmed !== '' && trimmed.toLowerCase() !== 'auto') return trimmed
  return interfaceLanguage()
}
