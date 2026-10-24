/**
 * The plugin row's configuration page.
 *
 * Registered into the Plugins page's keyed `plugins.row.config` slot under
 * `<package>#<row id>`, which is what gives the row a Configure control. It
 * renders the same form as the card does, but as page content: no floating
 * position, no click-through layer, and wide enough for a textarea.
 *
 * @module dsh-selection-translate/client/settings-page
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { TranslateLimits } from '../shared.ts'
import { ConfigPanel } from './config-panel.tsx'
import type { SelectionTranslateRemote } from './contracts.ts'
import { record } from './debug.ts'
import { messagesFor, resolveLocale } from './i18n.ts'
import { describeFailureText } from './failure.ts'
import { STYLE_ELEMENT_ATTRIBUTE, STYLES } from './styles.ts'
import { defaultEditableSettings, editableFromLimits, useSelectionSettings } from './use-settings.ts'

/** What the page needs from the plugin activation. */
export interface SettingsPageApi {
  /** Mounted Remote namespace. */
  readonly remote: SelectionTranslateRemote
}

/** Props of the registered row-config entry: this plugin's face plus the page's kit. */
export interface SettingsPageProps {
  /** Injected by the registering factory in `client/index.tsx`. */
  readonly api?: SettingsPageApi
  /** `'page'` (the form) or `'summary'` (a one-liner under the row title). */
  readonly view?: string
  /** Remaining page/owner props; unused by this entry. */
  readonly [key: string]: unknown
}

/**
 * The row configuration page.
 * @param props - injected Remote face plus the Plugins page view selector.
 * @returns the form, or nothing when the row's own contribution cannot load.
 */
export function SelectionTranslateSettingsPage(props: SettingsPageProps): ReactNode {
  const locale = useMemo(() => resolveLocale(), [])
  const messages = useMemo(() => messagesFor(locale), [locale])
  const api = props.api
  const [limits, setLimits] = useState<TranslateLimits | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (api === undefined) {
      record('settings/no-api')
      setFailure(messages.unknown)
      return
    }
    const controller = new AbortController()
    void Promise.resolve()
      .then(() => api.remote.limits(controller.signal))
      .then(
        (outcome) => {
          if (controller.signal.aborted) return
          if (outcome.ok) {
            record('settings/limits-ok', { namespace: outcome.value.namespace })
            setLimits(outcome.value)
            return
          }
          record('settings/limits-failed', outcome.error)
          setFailure(describeFailureText(outcome.error, messages))
        },
        (error: unknown) => {
          record('settings/limits-threw', error)
          setFailure(messages.unknown)
        },
      )
    return () => controller.abort()
  }, [api, messages])

  const adopt = useCallback((value: TranslateLimits) => {
    setLimits(value)
    setFailure(null)
  }, [])

  const controller = useSelectionSettings({
    remote: api?.remote,
    limits,
    messages,
    sample: 'Hello, world.',
    onSaved: adopt,
  })

  const value = limits === null ? defaultEditableSettings() : editableFromLimits(limits)

  if (props.view === 'summary') return messages.settingsTitle

  return (
    <div className="dsh-st-settings-page">
      <style {...{ [STYLE_ELEMENT_ATTRIBUTE]: 'page' }}>{STYLES}</style>
      <h4 className="dsh-st-settings-page-title">{messages.settingsTitle}</h4>
      {failure === null ? null : <div className="dsh-st-settings-note">{failure}</div>}
      <ConfigPanel
        locale={locale}
        messages={messages}
        value={value}
        writable={controller.writable && limits !== null}
        busy={controller.busy || limits === null}
        status={controller.status}
        statusKind={controller.statusKind}
        effectiveModel={limits?.model ?? ''}
        preview={controller.preview}
        onEdit={() => controller.clearStatus()}
        onSave={(next, diff) => {
          void controller.save(next, diff)
        }}
        onPreview={(next) => {
          void controller.showPreview(next)
        }}
      />
    </div>
  )
}

export default SelectionTranslateSettingsPage
