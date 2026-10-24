/**
 * Remote side of both configuration surfaces.
 *
 * The configuration UI exists twice — inside the translation card and on the
 * plugin row's page in the Plugins page — and both must behave identically: the
 * same revision fence, the same wording, the same recovery when a write lands
 * but the call that carried it does not. Keeping that logic here means a fix
 * applies to both instead of to whichever copy was noticed first.
 *
 * The draft itself belongs to the form; this hook only sends and reports.
 *
 * @module dsh-selection-translate/client/use-settings
 */

import { useCallback, useState } from 'react'

import {
  DEFAULT_MAX_CHARS,
  DEFAULT_MIN_CHARS,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_STYLE,
  DEFAULT_TARGET_LANGUAGE,
  isStylePreset,
  type PromptPreview,
  type StylePreset,
  type TranslateLimits,
  type TranslateSettingsPatch,
} from '../shared.ts'
import type { RemoteFailureLike, SelectionTranslateRemote } from './contracts.ts'
import type { Messages } from './i18n.ts'
import { destinationLanguage } from './language.ts'

/** The subset of the row config a browser form edits, as plain values. */
export interface EditableSettings {
  enabled: boolean
  sourceLanguage: string
  targetLanguage: string
  style: StylePreset
  customInstructions: string
  model: string
  minChars: number
  maxChars: number
}

/** Documented defaults, used before the Host has answered and by the reset button. */
export function defaultEditableSettings(): EditableSettings {
  return {
    enabled: true,
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    style: DEFAULT_STYLE,
    customInstructions: '',
    model: '',
    minChars: DEFAULT_MIN_CHARS,
    maxChars: DEFAULT_MAX_CHARS,
  }
}

/**
 * Project the Host's limits onto the editable subset.
 *
 * The model input holds the raw override, not the resolved route: a row that
 * follows the Host's default model must show an empty input, or saving the form
 * would silently pin whatever route happened to be in effect.
 * @param limits - limits as the Host reported them.
 * @returns the form values.
 */
export function editableFromLimits(limits: TranslateLimits): EditableSettings {
  return {
    enabled: limits.enabled,
    sourceLanguage: limits.sourceLanguage,
    targetLanguage: limits.targetLanguage,
    style: isStylePreset(limits.style) ? limits.style : DEFAULT_STYLE,
    customInstructions: limits.customInstructions,
    model: limits.modelOverride,
    minChars: limits.minChars,
    maxChars: limits.maxChars,
  }
}

/**
 * Build the patch for the whole draft.
 *
 * The prompt preview renders a configuration as if it were saved, so it needs
 * every editable field rather than only the changed ones.
 * @param value - draft values.
 * @returns a patch naming every editable field.
 */
export function settingsPatch(value: EditableSettings): TranslateSettingsPatch {
  return {
    enabled: value.enabled,
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
    style: value.style,
    customInstructions: value.customInstructions,
    model: value.model,
    minChars: value.minChars,
    maxChars: value.maxChars,
  }
}

/**
 * Diff a draft against the saved values.
 *
 * Only changed fields are sent: a patch that restates an untouched field would
 * make a concurrent edit to that field impossible to detect, and the Host would
 * refuse the write for no reason the user could see.
 * @param current - values as saved on the Host.
 * @param next - draft values.
 * @returns a patch naming only the changed fields.
 */
export function settingsDiff(current: EditableSettings, next: EditableSettings): TranslateSettingsPatch {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(current) as (keyof EditableSettings)[]) {
    if (current[key] !== next[key]) patch[key] = next[key]
  }
  return patch as TranslateSettingsPatch
}

/** Whether two form snapshots carry the same values. */
function sameSettings(left: EditableSettings, right: EditableSettings): boolean {
  return Object.keys(left).every((key) => left[key as keyof EditableSettings] === right[key as keyof EditableSettings])
}

/**
 * Word a settings failure for the panel.
 *
 * A deployment that serves no settings service — or a row the service refuses to
 * edit — is a different problem from a rejected value, and it has a different
 * remedy, the profile YAML, so the two do not share one sentence.
 * @param error - failure carried by the Remote result.
 * @param messages - active dictionary.
 * @returns one status line.
 */
function errorText(error: RemoteFailureLike, messages: Messages): string {
  const unavailable = /no settings service|no volatile fields|not configurable/i.test(error.message)
  const base = unavailable ? messages.settingsUnavailable : messages.saveFailed
  const detail = error.message.trim()
  return detail === '' ? base : `${base} — ${detail}`
}

/** What the surfaces need from the hook. */
export interface SelectionSettingsController {
  /** Whether a Remote call is in flight. */
  readonly busy: boolean
  /** One status line: saving, saved, or the reason a save failed. */
  readonly status: string | null
  /** Tone of {@link status}. */
  readonly statusKind: 'ok' | 'error' | null
  /**
   * Drop {@link status}.
   *
   * A confirmed save leaves its status on screen until the user edits the form;
   * the form calls this then, so a stale "saved" line cannot sit above values
   * that are no longer what was saved.
   */
  clearStatus(): void
  /** Whether this deployment can persist a write. */
  readonly writable: boolean
  /** Rendered prompt of the last preview, or null before the first one. */
  readonly preview: PromptPreview | null
  /** Write the changed fields through the Host settings service. */
  save(next: EditableSettings, patch: TranslateSettingsPatch): Promise<void>
  /** Render the draft's prompt without calling a model. */
  showPreview(next: EditableSettings): Promise<void>
}

/** Arguments of {@link useSelectionSettings}. */
export interface UseSelectionSettingsOptions {
  /** Mounted Remote namespace, or undefined before the contribution resolves. */
  readonly remote: SelectionTranslateRemote | undefined
  /** Limits as the Host last reported them; also the revision fence for a save. */
  readonly limits: TranslateLimits | null
  /** Active dictionary. */
  readonly messages: Messages
  /** Text the prompt preview renders into the user message; empty asks the Host for its placeholder. */
  readonly sample: string
  /** Called once a save is confirmed, so the surface can adopt the returned limits. */
  readonly onSaved?: (value: TranslateLimits) => void
}

/**
 * Send a settings write, then tell the caller how it went.
 * @param options - Remote face, saved limits, dictionary, preview sample, and save sink.
 * @returns the status line plus the two handlers.
 */
export function useSelectionSettings(options: UseSelectionSettingsOptions): SelectionSettingsController {
  const { remote, limits, messages, sample, onSaved } = options
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [statusKind, setStatusKind] = useState<'ok' | 'error' | null>(null)
  const [preview, setPreview] = useState<PromptPreview | null>(null)

  const save = useCallback(
    async (next: EditableSettings, patch: TranslateSettingsPatch) => {
      if (remote === undefined || limits === null || busy) return
      if (Object.keys(patch).length === 0) return
      setBusy(true)
      setStatus(messages.saving)
      setStatusKind(null)
      const controller = new AbortController()
      // A settings write re-activates the Host row on some compositions, which
      // can drop the in-flight invocation after the values were already
      // persisted. Reading the limits back and comparing them with the draft is
      // what tells a lost answer apart from a refused write.
      const confirm = async (failure: string): Promise<void> => {
        try {
          const reread = await remote.limits(controller.signal)
          if (reread.ok && sameSettings(editableFromLimits(reread.value), next)) {
            setStatus(messages.saved)
            setStatusKind('ok')
            setPreview(null)
            onSaved?.(reread.value)
            return
          }
        } catch {
          // A read-back that fails leaves the original failure as the answer.
        }
        setStatus(failure)
        setStatusKind('error')
      }
      try {
        const outcome = await remote.saveSettings({ patch, expectedRevision: limits.revision }, controller.signal)
        if (outcome.ok) {
          setStatus(messages.saved)
          setStatusKind('ok')
          setPreview(null)
          onSaved?.(outcome.value)
          return
        }
        await confirm(errorText(outcome.error, messages))
      } catch (error) {
        await confirm(`${messages.saveFailed} — ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setBusy(false)
      }
    },
    [remote, limits, busy, messages, onSaved],
  )

  const clearStatus = useCallback(() => {
    setStatus(null)
    setStatusKind(null)
  }, [])

  const showPreview = useCallback(
    async (next: EditableSettings) => {
      if (remote === undefined || busy) return
      setBusy(true)
      try {
        const outcome = await remote.describePrompt(
          {
            sample,
            draft: settingsPatch(next),
            resolvedTargetLanguage: destinationLanguage(next.targetLanguage),
          },
          new AbortController().signal,
        )
        if (outcome.ok) {
          setPreview(outcome.value)
          setStatus(null)
          setStatusKind(null)
          return
        }
        setStatus(errorText(outcome.error, messages))
        setStatusKind('error')
      } catch (error) {
        setStatus(`${messages.saveFailed} — ${error instanceof Error ? error.message : String(error)}`)
        setStatusKind('error')
      } finally {
        setBusy(false)
      }
    },
    [remote, busy, sample, messages],
  )

  return {
    busy,
    status,
    statusKind,
    writable: limits?.writable ?? false,
    preview,
    clearStatus,
    save,
    showPreview,
  }
}
