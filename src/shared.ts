/**
 * Contract shared by the Host half, the browser half, and both Typert
 * artifacts: the package identity, the wire method names, the request/result
 * shapes, and the failure codes.
 *
 * This module stays free of Node and DOM dependencies so both build targets can
 * import it.
 *
 * @module dsh-selection-translate/shared
 */

/** Package name: the Client module id, the Typert artifact owner, and the patch row target. */
export const PACKAGE = 'dsh-selection-translate'

/**
 * Cordis service key of the Host service. The Typert Gateway resolves every
 * invocation through `ctx.get(descriptor.service)`, so this string must equal
 * the key passed to the `Service` constructor.
 */
export const SERVICE_KEY = 'selectionTranslate'

/** Wire namespace: the first segment of every endpoint below. */
export const NAMESPACE = SERVICE_KEY

/** Endpoint reading the effective limits without sending any text. */
export const LIMITS_ENDPOINT = `${NAMESPACE}/limits`

/** Endpoint translating one selected fragment. */
export const TRANSLATE_ENDPOINT = `${NAMESPACE}/translate`

/**
 * Endpoint translating one selected fragment as a stream of text deltas.
 *
 * Separate from {@link TRANSLATE_ENDPOINT} on purpose: the unary endpoint is the
 * compatibility and fallback path (and the one a deployment without stream
 * support still answers), while this one is what the card prefers so a long
 * translation appears while the model is still writing it.
 */
export const TRANSLATE_STREAM_ENDPOINT = `${NAMESPACE}/translateStream`

/**
 * Endpoint writing the row config through the Host settings service.
 *
 * The segment after the slash is the *method name* both faces expose: the
 * Gateway dispatches `selectionTranslate/<method>` to `service.<method>()` and
 * the browser mounts `ctx.remote.selectionTranslate.<method>()`, so this cannot
 * be a shorter alias for `saveSettings` unless the Host method is renamed too.
 */
export const SETTINGS_ENDPOINT = `${NAMESPACE}/saveSettings`

/** Endpoint rendering the prompt of a draft configuration; same naming rule as above. */
export const PROMPT_ENDPOINT = `${NAMESPACE}/describePrompt`

/** Client module id (must equal {@link PACKAGE} for the served bundle). */
export const CLIENT_MODULE_ID = PACKAGE

/** Shortest selection that opens the button, in UTF-16 code units. */
export const DEFAULT_MIN_CHARS = 2

/** Longest text one request accepts, in UTF-16 code units. */
export const DEFAULT_MAX_CHARS = 4000

/** Entries kept by the Host translation cache. */
export const DEFAULT_CACHE_SIZE = 64

/** Upper bound for one model call, in output tokens. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048

/** `targetLanguage` sentinel meaning "follow the interface language". */
export const AUTO_LANGUAGE = 'auto'

/** Source language assumed when the row config carries no explicit tag. */
export const DEFAULT_SOURCE_LANGUAGE = 'en'

/** Destination language of a selection translation out of the box. */
export const DEFAULT_TARGET_LANGUAGE = 'zh-CN'

/**
 * Row id this package's own `cordis.patch.yml` inserts.
 *
 * The Host reports the real id (a profile may have renamed the row) and the
 * browser keys the row's configuration page by it; this constant is only the
 * fallback for a deployment that cannot name the entry.
 */
export const DEFAULT_NAMESPACE = 'selection-translate'

/** Translation styles the system prompt can encode. */
export const STYLE_PRESETS = ['fluent', 'literal', 'technical', 'preserve-tone'] as const

/** One translation style preset. */
export type StylePreset = (typeof STYLE_PRESETS)[number]

/** Style used when the row config names none. */
export const DEFAULT_STYLE: StylePreset = 'fluent'

/** Longest custom instruction block the row accepts, in UTF-16 code units. */
export const MAX_CUSTOM_INSTRUCTIONS = 2000

/**
 * Whether a value is one of the style presets.
 * @param value - untrusted value, typically from a wire request.
 * @returns true when the value names a known preset.
 */
export function isStylePreset(value: unknown): value is StylePreset {
  return typeof value === 'string' && (STYLE_PRESETS as readonly string[]).includes(value)
}

/** One language the configuration panel offers. */
export interface LanguageOption {
  /** BCP 47 tag sent on the wire and stored in the row config. */
  readonly tag: string
  /** English label. */
  readonly en: string
  /** Chinese label. */
  readonly zh: string
}

/** Languages the panel offers; a hand-typed tag in `cordis.patch.yml` still works. */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { tag: 'en', en: 'English', zh: '英语' },
  { tag: 'zh-CN', en: 'Simplified Chinese', zh: '简体中文' },
  { tag: 'zh-TW', en: 'Traditional Chinese', zh: '繁体中文' },
  { tag: 'ja', en: 'Japanese', zh: '日语' },
  { tag: 'ko', en: 'Korean', zh: '韩语' },
  { tag: 'fr', en: 'French', zh: '法语' },
  { tag: 'de', en: 'German', zh: '德语' },
  { tag: 'es', en: 'Spanish', zh: '西班牙语' },
  { tag: 'ru', en: 'Russian', zh: '俄语' },
  { tag: 'pt', en: 'Portuguese', zh: '葡萄牙语' },
  { tag: 'it', en: 'Italian', zh: '意大利语' },
]

/** One translation request supplied by the browser. */
export interface TranslateRequest {
  /** Exact selection snapshot; the Host never reads the DOM. */
  readonly text: string
  /**
   * BCP 47 destination language, or {@link AUTO_LANGUAGE}. The browser resolves
   * `auto` against its own interface language before calling.
   */
  readonly targetLanguage: string
}

/** One successful translation. */
export interface TranslateResult {
  /** Translated text with the source line breaks and code fences preserved. */
  readonly translation: string
  /** Destination language actually used. */
  readonly targetLanguage: string
  /** `provider/model` route the Host called. */
  readonly model: string
  /** Whether the answer came from the Host cache instead of a model call. */
  readonly cached: boolean
  /** Source length in UTF-16 code units. */
  readonly chars: number
}

/**
 * One item of {@link TRANSLATE_STREAM_ENDPOINT}.
 *
 * A stream carries zero or more `delta` items — each the next slice of the
 * model's output, in order — and ends with exactly one `done` item carrying the
 * same result the unary endpoint would have returned. The final result, not the
 * concatenated deltas, is authoritative: the Host trims it, so a card that
 * replaces its buffer with `done.result.translation` cannot drift.
 */
export type TranslateEvent =
  | {
      /** Next slice of model output; append it to the text already received. */
      readonly kind: 'delta'
      readonly text: string
    }
  | {
      /** Terminal item: the finished result, identical to the unary answer. */
      readonly kind: 'done'
      readonly result: TranslateResult
    }

/** Effective Host limits and settings the browser needs. */
export interface TranslateLimits {
  /** Master switch; `false` hides the whole feature in the browser. */
  readonly enabled: boolean
  /** Source language tag, or `auto` to let the model detect it. */
  readonly sourceLanguage: string
  /** Configured destination language (`auto` follows the interface language). */
  readonly targetLanguage: string
  /** Translation style the system prompt encodes. */
  readonly style: StylePreset
  /** Extra instruction block appended to the system prompt; empty when unused. */
  readonly customInstructions: string
  /** Shortest selection that opens the button. */
  readonly minChars: number
  /** Longest text one request accepts. */
  readonly maxChars: number
  /**
   * Effective route the next call will use, as `provider/model`.
   *
   * This is *resolved*: an empty `modelOverride` falls back to the Host's
   * default model, so this field names the model that would actually run, and
   * it is empty only when no route resolves at all. A form must not put it back
   * into the override input, or a deployment following the default model would
   * look as if the route had been pinned; see {@link modelOverride}.
   */
  readonly model: string
  /**
   * Raw `config.model` override, verbatim: `provider/model`, or an empty string
   * when the row follows the Host's default model.
   *
   * Unlike {@link model} this is never resolved, so it is the value the settings
   * form edits.
   */
  readonly modelOverride: string
  /** Settings namespace (the row id) a write must address; empty when unknown. */
  readonly namespace: string
  /** Revision the next write must expect, so a stale form cannot overwrite a newer one. */
  readonly revision: number
  /** Whether this deployment can persist a write at all. */
  readonly writable: boolean
}

/** Row config fields a browser is allowed to change. */
export interface TranslateSettingsPatch {
  readonly enabled?: boolean
  readonly sourceLanguage?: string
  readonly targetLanguage?: string
  readonly style?: StylePreset
  readonly customInstructions?: string
  readonly model?: string
  readonly minChars?: number
  readonly maxChars?: number
  readonly cacheSize?: number
  readonly maxOutputTokens?: number
}

/** One settings write supplied by the browser. */
export interface SaveSettingsRequest {
  /** Fields to change; fields left out keep their current value. */
  readonly patch: TranslateSettingsPatch
  /** Revision the form was built from; the Host refuses a stale write. */
  readonly expectedRevision: number
}

/** One prompt preview request supplied by the browser. */
export interface PromptPreviewRequest {
  /** Sample text the preview renders into the user message. */
  readonly sample: string
  /** Configuration draft the preview should pretend is saved. */
  readonly draft: TranslateSettingsPatch
  /** Browser-resolved concrete destination language; an empty string means unknown. */
  readonly resolvedTargetLanguage: string
}

/** The two messages one translation call would send. */
export interface PromptPreview {
  readonly system: string
  readonly user: string
}

/** Failure codes this package throws as `RemoteError`s. */
export interface TranslateErrorDetailsMap {
  /** The plugin row is switched off. */
  'selection-translate/disabled': { readonly hint: string }
  /** The selection is too short, too long, or empty. */
  'selection-translate/rejected-text': { readonly minChars: number; readonly maxChars: number; readonly chars: number }
  /** No provider/model route could be resolved for the call. */
  'selection-translate/no-model': { readonly hint: string }
  /** The model call failed or was cancelled. */
  'selection-translate/model-failed': { readonly reason: string }
  /** The settings write could not be performed; the profile YAML stays the fallback. */
  'selection-translate/settings-failed': { readonly reason: string }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Merge this package's business failures into the shared Remote failure vocabulary. */
  interface RemoteErrorDetailsMap extends TranslateErrorDetailsMap {}
}

/** Failure code union this package raises. */
export type TranslateErrorCode = keyof TranslateErrorDetailsMap
