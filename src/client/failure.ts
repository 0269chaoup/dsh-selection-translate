/**
 * Wording of Remote failures.
 *
 * The card and the configuration surfaces both receive `selection-translate/*`
 * codes and must turn them into the same sentence; a code that only one of them
 * knows would surface as a raw transport string in the other.
 *
 * @module dsh-selection-translate/client/failure
 */

import type { RemoteFailureLike } from './contracts.ts'
import type { Messages } from './i18n.ts'

/** One failure as the card renders it. */
export interface DescribedFailure {
  /** Localized headline. */
  readonly title: string
  /** Host diagnostic, shown small under the headline. */
  readonly detail?: string
}

/**
 * Format a Remote failure for the card.
 * @param error - failure carried by the Remote result.
 * @param messages - active dictionary.
 * @returns a readable sentence, plus the Host diagnostic as a detail line.
 */
export function describeFailure(error: RemoteFailureLike, messages: Messages): DescribedFailure {
  switch (error.code) {
    case 'selection-translate/disabled':
      return { title: messages.disabled }
    case 'selection-translate/rejected-text':
      return { title: messages.failed, detail: error.message }
    case 'selection-translate/no-model':
      return { title: messages.noModel, detail: error.message }
    case 'selection-translate/model-failed':
      if (/busy/.test(error.message)) return { title: messages.busy, detail: error.message }
      if (/cancel/.test(error.message)) return { title: messages.cancelled }
      return { title: messages.failed, detail: error.message }
    case 'selection-translate/settings-failed':
      return { title: messages.saveFailed, detail: error.message }
    case 'gateway/cancelled':
      return { title: messages.cancelled }
    case 'gateway/internal':
      return { title: messages.unknown, detail: error.message }
    default:
      return { title: error.message === '' ? messages.unknown : error.message }
  }
}

/**
 * Format a Remote failure as one line, for a surface without a detail line.
 * @param error - failure carried by the Remote result.
 * @param messages - active dictionary.
 * @returns headline and detail joined.
 */
export function describeFailureText(error: RemoteFailureLike, messages: Messages): string {
  const described = describeFailure(error, messages)
  return described.detail === undefined ? described.title : `${described.title} — ${described.detail}`
}
