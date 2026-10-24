/**
 * The configuration form itself.
 *
 * Deliberately a pure view: it owns its draft but no Remote call and no saved
 * state, so the same component renders inside the translation card and on the
 * plugin row's page without either surface inheriting the other's lifecycle.
 *
 * Every control is hand-written. A Client bundle may only reach React in the
 * shell's module table — no `@deepseek-ai/ui-*` package is mountable from a
 * third-party bundle — and the host's form primitives are exactly that.
 *
 * Layout: three groups (basics / language & style / advanced) over one shared
 * row grid — a fixed 96px right-aligned label column and a flexible control
 * column — so a 30px input, a 62px textarea and a 34px switch all line up on
 * the same optical edge. The master switch is the one exception: it owns a
 * full-width row because a label column would push it 96px off the reading
 * order.
 *
 * @module dsh-selection-translate/client/config-panel
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  LANGUAGE_OPTIONS,
  MAX_CUSTOM_INSTRUCTIONS,
  STYLE_PRESETS,
  type PromptPreview,
  type StylePreset,
  type TranslateSettingsPatch,
} from '../shared.ts'
import { copyText } from './clipboard.ts'
import type { Messages } from './i18n.ts'
import { defaultEditableSettings, settingsDiff, type EditableSettings } from './use-settings.ts'

/** Longest selection bound the form offers, in UTF-16 code units. */
const MAX_LENGTH_CEILING = 20000

/** Props of the configuration form. */
export interface ConfigPanelProps {
  /** Interface language, used for the language option labels. */
  readonly locale: 'zh' | 'en'
  /** Active dictionary. */
  readonly messages: Messages
  /** Values as they are saved on the Host; also the diff baseline. */
  readonly value: EditableSettings
  /** Whether this deployment can persist a write. */
  readonly writable: boolean
  /** Whether a Remote call is in flight. */
  readonly busy: boolean
  /** One status line, already worded. */
  readonly status: string | null
  /** Tone of {@link ConfigPanelProps.status}. */
  readonly statusKind?: 'ok' | 'error' | null
  /**
   * Route the next call would use, as the Host resolved it; empty when no route
   * resolves. Shown under the model input so an empty override still tells the
   * user which model actually runs.
   */
  readonly effectiveModel?: string
  /** Rendered prompt of the last preview, shown under a disclosure when present. */
  readonly preview: PromptPreview | null
  /** Save handler; both arguments are already computed for the caller. */
  onSave(next: EditableSettings, diff: TranslateSettingsPatch): void
  /** Preview handler. */
  onPreview(next: EditableSettings): void
  /** Called on every draft edit, so the surface can drop a stale status line. */
  onEdit?(): void
}

/** One label of a style preset in the active language. */
function styleLabel(style: StylePreset, messages: Messages): string {
  switch (style) {
    case 'literal':
      return messages.styleLiteral
    case 'technical':
      return messages.styleTechnical
    case 'preserve-tone':
      return messages.stylePreserveTone
    default:
      return messages.styleFluent
  }
}

/**
 * The configuration form.
 * @param props - saved values plus the handlers the owning surface supplies.
 * @returns the form.
 */
export function ConfigPanel(props: ConfigPanelProps): ReactNode {
  const { locale, messages, value, writable, busy, status, statusKind, effectiveModel, preview } = props
  const [draft, setDraft] = useState<EditableSettings>(value)
  const [copied, setCopied] = useState<'system' | 'user' | null>(null)

  // Reset the draft when the *saved* values move (the first load, or the answer
  // to a save). Keying on the values instead of the object identity keeps a
  // parent re-render from discarding edits the user has not saved yet.
  const saved = useMemo(() => JSON.stringify(value), [value])
  useEffect(() => {
    setDraft(value)
  }, [saved])

  const diff = useMemo(() => settingsDiff(value, draft), [value, draft])
  const dirty = Object.keys(diff).length > 0
  const editable = writable && !busy
  // The two bounds are checked together because either can make the pair
  // impossible; nothing is clamped, so what the user typed is what they see.
  const boundsInvalid = !Number.isFinite(draft.minChars) || draft.minChars < 1 || draft.minChars > draft.maxChars

  const edit = (patch: Partial<EditableSettings>): void => {
    setDraft((previous) => ({ ...previous, ...patch }))
    setCopied(null)
    props.onEdit?.()
  }

  const copy = (which: 'system' | 'user'): void => {
    const text = which === 'system' ? (preview?.system ?? '') : (preview?.user ?? '')
    void copyText(text).then((ok) => {
      if (ok) setCopied(which)
    })
  }

  return (
    <div className="dsh-st-settings">
      {writable ? null : <div className="dsh-st-settings-note">{messages.settingsUnavailable}</div>}

      <div className="dsh-st-settings-toggle">
        <span className="dsh-st-settings-toggle-text">
          <span className="dsh-st-settings-toggle-title">{messages.enabledLabel}</span>
          <span className="dsh-st-settings-toggle-desc">
            {draft.enabled ? messages.enabledHint : messages.disabled}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={messages.enabledLabel}
          className="dsh-st-settings-switch"
          disabled={!editable}
          onClick={() => edit({ enabled: !draft.enabled })}
        >
          <span className="dsh-st-settings-knob" />
        </button>
      </div>

      <div className="dsh-st-settings-group">
        <div className="dsh-st-settings-group-title">{messages.groupBasic}</div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.minCharsLabel}</span>
          <div className="dsh-st-settings-controls">
            <div className="dsh-st-settings-numrow">
              <input
                className={`dsh-st-settings-input dsh-st-settings-num${
                  boundsInvalid ? ' dsh-st-settings-input-invalid' : ''
                }`}
                type="number"
                min={1}
                max={draft.maxChars}
                step={1}
                value={draft.minChars}
                disabled={!editable}
                aria-invalid={boundsInvalid}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10)
                  edit({ minChars: Number.isFinite(next) ? next : draft.minChars })
                }}
              />
              <span className="dsh-st-settings-unit">{messages.charsUnit}</span>
            </div>
            {boundsInvalid ? (
              <span className="dsh-st-settings-field-error">{messages.minCharsInvalid}</span>
            ) : null}
          </div>
        </div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.lengthLabel}</span>
          <div className="dsh-st-settings-controls">
            <div className="dsh-st-settings-numrow">
              <input
                className={`dsh-st-settings-input dsh-st-settings-num${
                  boundsInvalid ? ' dsh-st-settings-input-invalid' : ''
                }`}
                type="number"
                min={1}
                max={MAX_LENGTH_CEILING}
                step={100}
                value={draft.maxChars}
                disabled={!editable}
                aria-invalid={boundsInvalid}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10)
                  edit({ maxChars: Number.isFinite(next) ? next : draft.maxChars })
                }}
              />
              <span className="dsh-st-settings-unit">{messages.charsUnit}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dsh-st-settings-group">
        <div className="dsh-st-settings-group-title">{messages.groupLanguage}</div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.sourceLabel}</span>
          <div className="dsh-st-settings-controls">
            <select
              className="dsh-st-settings-select"
              value={draft.sourceLanguage}
              disabled={!editable}
              onChange={(event) => edit({ sourceLanguage: event.target.value })}
            >
              <option value="auto">{messages.autoDetect}</option>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.tag} value={option.tag}>
                  {locale === 'zh' ? option.zh : option.en}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.targetLabel}</span>
          <div className="dsh-st-settings-controls">
            <select
              className="dsh-st-settings-select"
              value={draft.targetLanguage}
              disabled={!editable}
              onChange={(event) => edit({ targetLanguage: event.target.value })}
            >
              <option value="auto">{messages.autoFollow}</option>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.tag} value={option.tag}>
                  {locale === 'zh' ? option.zh : option.en}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.styleLabel}</span>
          <div className="dsh-st-settings-controls">
            <select
              className="dsh-st-settings-select"
              value={draft.style}
              disabled={!editable}
              onChange={(event) => edit({ style: event.target.value as StylePreset })}
            >
              {STYLE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {styleLabel(preset, messages)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.customPromptLabel}</span>
          <div className="dsh-st-settings-controls">
            <textarea
              className="dsh-st-settings-textarea"
              rows={4}
              maxLength={MAX_CUSTOM_INSTRUCTIONS}
              value={draft.customInstructions}
              placeholder={messages.customPromptPlaceholder}
              disabled={!editable}
              onChange={(event) => edit({ customInstructions: event.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="dsh-st-settings-group">
        <div className="dsh-st-settings-group-title">{messages.groupAdvanced}</div>
        <div className="dsh-st-settings-row">
          <span className="dsh-st-settings-label">{messages.modelLabel}</span>
          <div className="dsh-st-settings-controls">
            <div className="dsh-st-settings-field">
              <input
                className="dsh-st-settings-input"
                type="text"
                value={draft.model}
                placeholder={messages.modelPlaceholder}
                disabled={!editable}
                onChange={(event) => edit({ model: event.target.value })}
              />
              {effectiveModel === undefined || effectiveModel === '' ? null : (
                <span className="dsh-st-settings-route">
                  <i aria-hidden="true" />
                  {messages.modelEffective(effectiveModel)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="dsh-st-settings-actions">
        <button
          type="button"
          className="dsh-st-btn dsh-st-btn-primary"
          disabled={!editable || !dirty || boundsInvalid}
          onClick={() => props.onSave(draft, diff)}
        >
          {busy ? messages.saving : messages.save}
        </button>
        <button
          type="button"
          className="dsh-st-btn dsh-st-btn-secondary"
          disabled={!editable}
          onClick={() => props.onPreview(draft)}
        >
          {messages.previewRun}
        </button>
        <button
          type="button"
          className="dsh-st-btn dsh-st-btn-ghost"
          disabled={!editable}
          onClick={() => {
            setDraft(defaultEditableSettings())
            setCopied(null)
            props.onEdit?.()
          }}
        >
          {messages.resetDefaults}
        </button>
        <span
          className={`dsh-st-settings-status${
            statusKind === 'ok' ? ' dsh-st-settings-status-ok' : statusKind === 'error' ? ' dsh-st-settings-status-error' : ''
          }`}
        >
          {status ?? ''}
        </span>
      </div>

      {preview === null ? null : (
        <details className="dsh-st-settings-preview">
          <summary className="dsh-st-settings-preview-head">{messages.previewTitle}</summary>
          <div className="dsh-st-settings-preview-body">
            <div className="dsh-st-settings-preview-block">
              <div className="dsh-st-settings-preview-blockhead">
                <span className="dsh-st-settings-preview-tag">{messages.previewSystem}</span>
                <button
                  type="button"
                  className="dsh-st-btn dsh-st-btn-secondary dsh-st-btn-sm"
                  onClick={() => copy('system')}
                >
                  {copied === 'system' ? messages.copied : messages.copy}
                </button>
              </div>
              <pre className="dsh-st-settings-pre">{preview.system}</pre>
            </div>
            <div className="dsh-st-settings-preview-block">
              <div className="dsh-st-settings-preview-blockhead">
                <span className="dsh-st-settings-preview-tag">{messages.previewUser}</span>
                <button
                  type="button"
                  className="dsh-st-btn dsh-st-btn-secondary dsh-st-btn-sm"
                  onClick={() => copy('user')}
                >
                  {copied === 'user' ? messages.copied : messages.copy}
                </button>
              </div>
              <pre className="dsh-st-settings-pre">{preview.user}</pre>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

export default ConfigPanel
