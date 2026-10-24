/**
 * Host half of the selection-translate plugin.
 *
 * The Host owns everything that needs a credential or a provider route:
 * resolving `provider/model`, one `ctx.llm.stream()` call per uncached request,
 * the bounded LRU cache, and the length/concurrency guards. The browser half
 * never sees an API key — it sends one selection over the same-origin Typert
 * Remote carrier and receives finished text.
 *
 * The Host also owns the configuration: the browser edits the row through the
 * `settings` service so the profile's user layer stays the single source of
 * truth, and a deployment without that service keeps working from
 * `cordis.patch.yml` alone.
 *
 * Exported as a Cordis Service class (the "service as default export" plugin
 * form): `static inject` declares the services the Host must have,
 * `static Config` is the schemastery schema the profile row's `config` is
 * validated against, and the Typert decorators expose the Remote methods.
 *
 * @module dsh-selection-translate
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm/types'

import { cacheKey, LruCache } from './cache.ts'
import { buildSystemPrompt, buildUserPrompt, isExplicitLanguage } from './prompt.ts'
import {
  AUTO_LANGUAGE,
  DEFAULT_CACHE_SIZE,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MIN_CHARS,
  DEFAULT_NAMESPACE,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_STYLE,
  DEFAULT_TARGET_LANGUAGE,
  MAX_CUSTOM_INSTRUCTIONS,
  PACKAGE,
  SERVICE_KEY,
  STYLE_PRESETS,
  isStylePreset,
  type PromptPreview,
  type PromptPreviewRequest,
  type SaveSettingsRequest,
  type StylePreset,
  type TranslateEvent,
  type TranslateLimits,
  type TranslateRequest,
  type TranslateResult,
  type TranslateSettingsPatch,
} from './shared.ts'

/** Most model calls this service runs at the same time. */
const MAX_CONCURRENT_CALLS = 4

/** Resolved plugin config, after schema defaults, as plain data. */
export interface Config {
  /** Master switch for the whole feature; `false` answers every call with a refusal. */
  enabled: boolean
  /** Source language tag, or `auto` to let the model detect it. */
  sourceLanguage: string
  /** Destination language, or `auto` to follow the interface language the browser reports. */
  targetLanguage: string
  /** Translation style encoded as rule 6 of the system prompt. */
  style: StylePreset
  /** Extra instruction block appended to the system prompt as rule 7. */
  customInstructions: string
  /** `provider/model` override; blank follows the Host's configured default model. */
  model: string
  /** Shortest accepted selection, in UTF-16 code units. */
  minChars: number
  /** Longest accepted selection, in UTF-16 code units. */
  maxChars: number
  /** Translation cache entries; `0` disables caching. */
  cacheSize: number
  /** Output-token ceiling of one model call. */
  maxOutputTokens: number
}

/** Defaults of every config field, mirrored from the schema for {@link configValues}. */
const CONFIG_DEFAULTS: Config = {
  enabled: true,
  sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  style: DEFAULT_STYLE,
  customInstructions: '',
  model: '',
  minChars: DEFAULT_MIN_CHARS,
  maxChars: DEFAULT_MAX_CHARS,
  cacheSize: DEFAULT_CACHE_SIZE,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
}

/**
 * Project one finished translation onto the wire result.
 * @param call - the validated call it answers.
 * @param translation - trimmed model output, or the cached answer.
 * @param cached - whether this came from the cache rather than a model call.
 * @returns the result both endpoints carry.
 */
function resultOf(call: PreparedCall, translation: string, cached: boolean): TranslateResult {
  return {
    translation,
    targetLanguage: call.targetLanguage,
    model: call.route.label,
    cached,
    chars: call.chars,
  }
}

/** Config fields a browser may write, in form order. */
const WRITABLE_FIELDS = [
  'enabled',
  'sourceLanguage',
  'targetLanguage',
  'style',
  'customInstructions',
  'model',
  'minChars',
  'maxChars',
  'cacheSize',
  'maxOutputTokens',
] as const satisfies readonly (keyof Config)[]

/**
 * Read one parsed config field.
 *
 * The loader parses a volatile field into a live reference that the Cordis
 * volatile-update path rewrites in place, so a plain property read would hand
 * back the reference object instead of the value.
 * @param value - raw or referenced field value.
 * @returns the current plain value.
 */
function readField(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const ref = value as { get?: unknown }
  if (typeof ref.get !== 'function') return value
  return (ref.get as () => unknown)()
}

/**
 * Snapshot a config object as plain data.
 *
 * Works for both shapes a config arrives in: the live references the Cordis
 * loader commits volatile updates into, and a plain object from a programmatic
 * mount or from a merged settings draft. Missing fields fall back to the
 * documented defaults.
 * @param config - parsed config, raw partial config, or `undefined`.
 * @returns plain values with every field present.
 */
export function configValues(config: unknown): Config {
  const source = (config === null || typeof config !== 'object' ? {} : config) as Record<string, unknown>
  const values: Record<string, unknown> = { ...CONFIG_DEFAULTS }
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    if (!Object.hasOwn(source, key)) continue
    const value = readField(source[key])
    if (value !== undefined) values[key] = value
  }
  return values as unknown as Config
}

/**
 * Config schema of this plugin row.
 *
 * Every field is `volatile()`. That is what the Host settings service requires
 * before it will list or write a row (`describe()` projects volatile fields
 * only), and it is also what makes a write hot: the loader commits the new
 * values into the running references instead of re-activating this row, so an
 * open translation card keeps working across a settings save. Only the wire
 * type is plain — each field parses into a reference read through
 * {@link configValues}.
 */
const CONFIG_SCHEMA = z.object({
  enabled: z.boolean().default(true).volatile().description('Master switch for the selection-translate feature.'),
  sourceLanguage: z
    .string()
    .default(DEFAULT_SOURCE_LANGUAGE)
    .volatile()
    .description('Source language tag, or "auto" to let the model detect it.'),
  targetLanguage: z
    .string()
    .default(DEFAULT_TARGET_LANGUAGE)
    .volatile()
    .description('Destination language, or "auto" to follow the interface language the browser reports.'),
  style: z
    .union(STYLE_PRESETS.map((preset) => z.const(preset)))
    .default(DEFAULT_STYLE)
    .volatile()
    .description('Translation style: fluent, literal, technical, or preserve-tone.'),
  customInstructions: z
    .string()
    .max(MAX_CUSTOM_INSTRUCTIONS)
    .default('')
    .volatile()
    .description('Extra instruction block appended to the system prompt; empty for none.'),
  model: z
    .string()
    .default('')
    .volatile()
    .description('provider/model override; blank follows the Host default model selection.'),
  minChars: z.number().min(1).default(DEFAULT_MIN_CHARS).volatile().description('Shortest accepted selection.'),
  maxChars: z.number().min(1).default(DEFAULT_MAX_CHARS).volatile().description('Longest accepted selection.'),
  cacheSize: z.number().min(0).default(DEFAULT_CACHE_SIZE).volatile().description('Translation cache entries; 0 disables it.'),
  maxOutputTokens: z.number().min(1).default(DEFAULT_MAX_OUTPUT_TOKENS).volatile().description('Output-token ceiling of one call.'),
})

/** Schema the profile row's `config` is validated against. */
export const Config: z<Partial<Config>, Config> = CONFIG_SCHEMA as unknown as z<Partial<Config>, Config>

/** One resolved model route. */
interface ModelRoute {
  readonly provider: string
  readonly model: string
  /** `provider/model`, as recorded on the result and in the cache key. */
  readonly label: string
}

/** One request after validation and route resolution; both endpoints share it. */
interface PreparedCall {
  readonly config: Config
  readonly text: string
  readonly chars: number
  readonly route: ModelRoute
  readonly targetLanguage: string
  /** Cache identity of this call. */
  readonly key: string
}

/** The subset of the Host's default-model service this plugin reads. */
interface DefaultModelFace {
  currentSelection(): { provider?: string; model?: string }
}

/** The subset of the Host's `settings` service this plugin uses. */
interface SettingsServiceFace {
  describe(options?: { redactSecrets?: boolean }): unknown
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<unknown>
}

/** One row of a `settings.describe()` answer. */
interface SettingsRow {
  readonly ns?: unknown
  readonly revision?: unknown
}

/** One loader entry, as far as namespace discovery reads it. */
interface LoaderEntry {
  readonly options?: { readonly id?: unknown; readonly name?: unknown }
  readonly fiber?: unknown
  readonly disabled?: unknown
}

/** The `ctx.loader` face used to find this plugin's own row id. */
interface LoaderFace {
  entries(): Iterable<LoaderEntry>
}

/** Settings state a write needs: where it goes, which revision it expects, and whether it is possible. */
interface SettingsState {
  readonly namespace: string
  readonly revision: number
  readonly writable: boolean
}

/**
 * Read the Host's `settings` service without making it a hard dependency.
 *
 * Shapes differ between DSH versions, so every member is checked: a deployment
 * that serves something else under that key must fall back to "no settings"
 * instead of failing the Remote call with a TypeError.
 * @param ctx - plugin context.
 * @returns the settings service, or undefined when this deployment serves none.
 */
export function resolveSettings(ctx: Context): SettingsServiceFace | undefined {
  try {
    const service = ctx.get('settings') as Partial<SettingsServiceFace> | undefined
    if (service === undefined || service === null) return undefined
    if (typeof service.describe !== 'function' || typeof service.update !== 'function') return undefined
    return service as SettingsServiceFace
  } catch {
    return undefined
  }
}

/**
 * Read the rows of a `settings.describe()` answer.
 *
 * `describe()` returns a bare array in the shipped service; other versions wrap
 * it in `{ namespaces, writable }`, so both are accepted.
 * @param settings - resolved settings service.
 * @returns the row list, or an empty list when the answer has no usable shape.
 */
export function describeRows(settings: SettingsServiceFace): readonly SettingsRow[] {
  const described = settings.describe({ redactSecrets: true }) as unknown
  if (Array.isArray(described)) return described as readonly SettingsRow[]
  const wrapped = described as { namespaces?: unknown } | null
  return wrapped !== null && Array.isArray(wrapped?.namespaces) ? (wrapped.namespaces as readonly SettingsRow[]) : []
}

/**
 * Find this plugin's own profile row id.
 *
 * The id is the settings namespace, and a user may have renamed or duplicated
 * the row, so it is read from the live Loader tree rather than assumed. The
 * entry whose fiber owns this context wins; otherwise the first enabled entry
 * that loads this package.
 * @param ctx - plugin context.
 * @returns the row id, or {@link DEFAULT_NAMESPACE} when the tree is unavailable.
 */
export function ownNamespace(ctx: Context): string {
  try {
    const loader = (ctx as unknown as { loader?: LoaderFace }).loader
    if (loader === undefined || typeof loader.entries !== 'function') return DEFAULT_NAMESPACE
    const ownFiber = (ctx as unknown as { fiber?: unknown }).fiber
    let fallback: string | undefined
    for (const entry of loader.entries()) {
      const options = entry?.options
      if (options === undefined || options.name !== PACKAGE) continue
      const id = typeof options.id === 'string' && options.id !== '' ? options.id : undefined
      if (id === undefined) continue
      if (ownFiber !== undefined && entry.fiber === ownFiber) return id
      if (fallback === undefined && entry.disabled !== true) fallback = id
    }
    return fallback ?? DEFAULT_NAMESPACE
  } catch {
    return DEFAULT_NAMESPACE
  }
}

/**
 * Split a `provider/model` string.
 * @param value - configured override.
 * @returns the route, or undefined when the value is not a complete pair.
 */
export function parseModelRoute(value: string): { provider: string; model: string } | undefined {
  const trimmed = value.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return undefined
  const provider = trimmed.slice(0, slash)
  const model = trimmed.slice(slash + 1)
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * Read the LLM service without making it a hard dependency.
 *
 * A deployment that serves no model must still load this row: the browser then
 * receives a typed `no-model` refusal instead of a plugin that failed to mount.
 * @param ctx - plugin context.
 * @returns the LLM service, or undefined when this deployment serves none.
 */
export function resolveLlm(ctx: Context): LlmRuntime | undefined {
  try {
    const llm = ctx.get('llm') as LlmRuntime | undefined
    return llm !== undefined && typeof (llm as { stream?: unknown }).stream === 'function' ? llm : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the Host's configured default model selection.
 * @param ctx - plugin context.
 * @returns the configured route, or undefined when the deployment has no default-model service.
 */
export function resolveDefaultModel(ctx: Context): { provider: string; model: string } | undefined {
  try {
    const selection = ctx.get('agentDefaultModel') as DefaultModelFace | undefined
    if (selection === undefined || typeof selection.currentSelection !== 'function') return undefined
    const current = selection.currentSelection()
    if (typeof current?.provider !== 'string' || typeof current?.model !== 'string') return undefined
    if (current.provider === '' || current.model === '') return undefined
    return { provider: current.provider, model: current.model }
  } catch {
    return undefined
  }
}

/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Keep only the config fields a patch is allowed to name.
 * @param patch - untrusted patch object.
 * @returns the known fields with defined values.
 */
function pickWritable(patch: Record<string, unknown>): TranslateSettingsPatch {
  const picked: Record<string, unknown> = {}
  for (const key of WRITABLE_FIELDS) {
    if (!Object.hasOwn(patch, key)) continue
    const value = readField(patch[key])
    if (value !== undefined) picked[key] = value
  }
  return picked as TranslateSettingsPatch
}

/**
 * Compare two config snapshots.
 * @param current - values before the write.
 * @param next - values after the write.
 * @returns a patch naming only the fields that actually changed.
 */
function settingsDiff(current: Config, next: Config): TranslateSettingsPatch {
  const diff: Record<string, unknown> = {}
  for (const key of WRITABLE_FIELDS) {
    if (current[key] !== next[key]) diff[key] = next[key]
  }
  return diff as TranslateSettingsPatch
}

/** Human-readable text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Host-side translation service.
 *
 * Every Remote method is cancellation-aware: the Gateway injects the call's
 * `AbortSignal` after the decoded business parameters, so closing the card or
 * withdrawing the plugin aborts the provider request instead of leaking it.
 */
export default class SelectionTranslateService extends TypertRemoteService {
  /** No service is mandatory: `llm` and `settings` are resolved optionally so the row always mounts. */
  static inject: readonly string[] = []

  /** Schema the profile row's `config` is validated against. */
  static Config = Config

  /**
   * The config object the Cordis loader handed over, references included.
   *
   * It is kept as-is rather than re-parsed: re-parsing would produce detached
   * references, and a volatile settings write would then update the loader's
   * copy while this service kept reading the old one.
   */
  private readonly config: unknown

  private readonly cache: LruCache<string>

  /** In-flight calls keyed by cache key, so identical concurrent requests share one provider call. */
  private readonly inFlight = new Map<string, Promise<string>>()

  /** Number of provider calls currently running. */
  private active = 0

  /**
   * @param ctx - owning Host context.
   * @param config - row config. The loader passes parsed values (volatile fields
   *   are live references); a programmatic mount may pass plain values or an
   *   empty object, so the defaults are applied on every read.
   */
  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, SERVICE_KEY)
    // Validate once at mount so an invalid profile row fails where the operator
    // can see it, then keep the original object for live volatile reads.
    const snapshot = configValues(config)
    Config(snapshot as Partial<Config>)
    this.config = config
    this.cache = new LruCache<string>(snapshot.cacheSize)
    if (snapshot.enabled) {
      const route = this.route(snapshot)
      ctx.logger?.info?.(
        `[selection-translate] ready: source=${snapshot.sourceLanguage} target=${snapshot.targetLanguage} style=${snapshot.style} model=${route?.label ?? '(unresolved)'} cache=${snapshot.cacheSize}`,
      )
    }
  }

  /**
   * Read the effective limits without sending any text.
   *
   * The browser calls this once per activation so it can honour the Host's
   * switch, languages, style, selection bounds, and settings revision before it
   * renders anything.
   * @param _signal - call cancellation (unused; the read touches no I/O).
   * @returns the effective settings plus the settings namespace and revision.
   */
  @Remote
  async limits(_signal: AbortSignal): Promise<TranslateLimits> {
    return this.limitsFrom(this.values(), this.settingsState())
  }

  /**
   * Translate one selected fragment.
   * @param request - exact selection snapshot and resolved destination language.
   * @param signal - cancellation from the Remote carrier or the model call.
   * @returns the translated text plus the route, cache flag, and source length.
   * @throws RemoteError with a `selection-translate/*` code on every refusal or failure.
   */
  @Remote
  async translate(request: TranslateRequest, signal: AbortSignal): Promise<TranslateResult> {
    const call = this.prepare(request, signal)
    const cached = this.cache.get(call.key)
    if (cached !== undefined) return resultOf(call, cached, true)

    const shared = this.inFlight.get(call.key)
    if (shared !== undefined) return resultOf(call, await shared, true)
    if (this.active >= MAX_CONCURRENT_CALLS) {
      throw new RemoteError('selection-translate/model-failed', 'too many translations are running', { reason: 'busy' })
    }

    const pending = this.run(call, signal)
    this.inFlight.set(call.key, pending)
    this.active += 1
    try {
      const translation = await pending
      this.cache.set(call.key, translation)
      return resultOf(call, translation, false)
    } finally {
      this.active -= 1
      this.inFlight.delete(call.key)
    }
  }

  /**
   * Translate one selected fragment, yielding the model's text as it arrives.
   *
   * Same guards, same cache, same prompt as {@link translate}; the difference is
   * delivery. A cache hit or a call already in flight still streams — as a
   * single delta followed by `done` — so the card never needs a second code
   * path to render an instant answer.
   *
   * Streams are not registered in `inFlight`: a unary call that races a stream
   * for the same text starts its own provider call rather than adopting a
   * promise it did not create. The duplicate is bounded by the concurrency
   * limit and by the browser aborting the previous card, and it keeps this
   * generator free of a promise that would need settling on every exit path.
   * @param request - selection snapshot and destination language.
   * @param signal - cancellation, fired by Esc, a close, or a new selection.
   * @yields the text deltas, then exactly one `done` item carrying the result.
   * @throws RemoteError with the same codes the unary endpoint uses.
   */
  @Remote({ mode: 'stream' })
  async *translateStream(request: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateEvent> {
    const call = this.prepare(request, signal)
    const cached = this.cache.get(call.key)
    if (cached !== undefined) {
      yield { kind: 'delta', text: cached }
      yield { kind: 'done', result: resultOf(call, cached, true) }
      return
    }

    const shared = this.inFlight.get(call.key)
    if (shared !== undefined) {
      const translation = await shared
      yield { kind: 'delta', text: translation }
      yield { kind: 'done', result: resultOf(call, translation, true) }
      return
    }
    if (this.active >= MAX_CONCURRENT_CALLS) {
      throw new RemoteError('selection-translate/model-failed', 'too many translations are running', { reason: 'busy' })
    }

    const generator = this.streamText(call, signal)
    this.active += 1
    let translation: string | undefined
    try {
      for (;;) {
        const next = await generator.next()
        if (next.done === true) {
          translation = next.value
          break
        }
        if (next.value !== '') yield { kind: 'delta', text: next.value }
      }
      this.cache.set(call.key, translation)
      yield { kind: 'done', result: resultOf(call, translation, false) }
    } finally {
      this.active -= 1
      // A consumer that stops early (Esc, unmount, a new selection) closes the
      // provider stream here; `.return()` on a finished generator is a no-op.
      await generator.return('').catch(() => undefined)
    }
  }

  @Remote
  async saveSettings(request: SaveSettingsRequest, signal: AbortSignal): Promise<TranslateLimits> {
    const settings = resolveSettings(this.ctx)
    if (settings === undefined) {
      throw new RemoteError('selection-translate/settings-failed', 'this deployment serves no settings service', {
        reason: 'no-settings',
      })
    }
    const patch = request?.patch
    if (!isPlainObject(patch)) {
      throw new RemoteError('selection-translate/settings-failed', 'the settings patch must be a plain object', {
        reason: 'invalid-patch',
      })
    }
    const current = this.values()
    let next: Config
    try {
      // The full schema validates the merged candidate, so a bad style, an
      // over-long instruction block, or a non-numeric bound is refused before
      // anything reaches the profile document.
      next = configValues(Config({ ...current, ...pickWritable(patch) } as Partial<Config>))
    } catch (error) {
      throw new RemoteError('selection-translate/settings-failed', messageOf(error), { reason: 'invalid-value' })
    }
    const diff = settingsDiff(current, next)
    const state = this.settingsState()
    if (Object.keys(diff).length > 0) {
      if (signal.aborted) {
        throw new RemoteError('selection-translate/settings-failed', 'the settings write was cancelled', {
          reason: 'cancelled',
        })
      }
      const expected = typeof request?.expectedRevision === 'number' ? request.expectedRevision : undefined
      try {
        await settings.update(state.namespace, diff as Record<string, unknown>, expected)
      } catch (error) {
        // A revision mismatch arrives as a plain rejection from the settings
        // service; the original text is the only place the expected/actual
        // revisions are stated, so it is carried through verbatim.
        throw new RemoteError('selection-translate/settings-failed', messageOf(error), { reason: 'update-failed' })
      }
      this.cache.clear()
      if (diff.cacheSize !== undefined) this.cache.resize(next.cacheSize)
    }
    // The write itself can re-activate or dispose this row on some compositions,
    // so a read-back is best-effort: the merged values above are already the
    // truth the caller asked for.
    const after = this.settingsState()
    return this.limitsFrom(next, after)
  }

  /**
   * Render the prompt a draft configuration would send.
   *
   * The panel shows this before saving so the effect of a style or a custom
   * instruction is visible without spending a provider call.
   * @param request - sample text, draft fields, and the browser-resolved target.
   * @param _signal - call cancellation (unused; no I/O).
   * @returns the system and user messages of one translation.
   * @throws RemoteError `selection-translate/settings-failed` when the draft is invalid.
   */
  @Remote
  async describePrompt(request: PromptPreviewRequest, _signal: AbortSignal): Promise<PromptPreview> {
    const draft = isPlainObject(request?.draft) ? pickWritable(request.draft) : {}
    let merged: Config
    try {
      merged = configValues(Config({ ...this.values(), ...draft } as Partial<Config>))
    } catch (error) {
      throw new RemoteError('selection-translate/settings-failed', messageOf(error), { reason: 'invalid-value' })
    }
    const requested = typeof request?.resolvedTargetLanguage === 'string' ? request.resolvedTargetLanguage : ''
    const targetLanguage = isExplicitLanguage(requested)
      ? requested.trim()
      : isExplicitLanguage(merged.targetLanguage)
        ? merged.targetLanguage.trim()
        : DEFAULT_TARGET_LANGUAGE
    const sample = typeof request?.sample === 'string' && request.sample !== '' ? request.sample : 'Hello, world.'
    const profile = {
      sourceLanguage: merged.sourceLanguage,
      targetLanguage,
      style: merged.style,
      customInstructions: merged.customInstructions,
    }
    return { system: buildSystemPrompt(profile), user: buildUserPrompt(sample, profile) }
  }

  /** Plain snapshot of the live config. */
  private values(): Config {
    return configValues(this.config)
  }

  /** Where a write goes and whether this deployment can perform one. */
  private settingsState(): SettingsState {
    const namespace = ownNamespace(this.ctx)
    const settings = resolveSettings(this.ctx)
    if (settings === undefined) return { namespace, revision: 0, writable: false }
    try {
      const described = settings.describe({ redactSecrets: true }) as unknown
      const writable = Array.isArray(described) ? true : (described as { writable?: unknown } | null)?.writable !== false
      const row = describeRows(settings).find((candidate) => candidate?.ns === namespace)
      const revision = typeof row?.revision === 'number' ? row.revision : 0
      return { namespace, revision, writable }
    } catch {
      // A settings service that cannot describe itself cannot take a write
      // either; saying so up front beats a failed save later.
      return { namespace, revision: 0, writable: false }
    }
  }

  /** Project one config snapshot and settings state onto the wire result. */
  private limitsFrom(config: Config, state: SettingsState): TranslateLimits {
    return {
      enabled: config.enabled,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      style: isStylePreset(config.style) ? config.style : DEFAULT_STYLE,
      customInstructions: config.customInstructions,
      minChars: config.minChars,
      maxChars: config.maxChars,
      model: this.route(config)?.label ?? '',
      modelOverride: config.model,
      namespace: state.namespace,
      revision: state.revision,
      writable: state.writable,
    }
  }

  /**
   * Resolve the model route for the next call: an explicit override first, then
   * the Host's configured default model.
   * @param config - config snapshot to read the override from.
   * @returns the resolved route, or undefined when neither is available.
   */
  private route(config: Config): ModelRoute | undefined {
    const override = parseModelRoute(config.model)
    if (override !== undefined) return { ...override, label: `${override.provider}/${override.model}` }
    const fallback = resolveDefaultModel(this.ctx)
    if (fallback !== undefined) return { ...fallback, label: `${fallback.provider}/${fallback.model}` }
    return undefined
  }

  /**
   * Validate one request and resolve everything both endpoints need.
   * @param request - browser-supplied selection and destination language.
   * @param signal - cancellation, checked once before any work starts.
   * @returns the validated call, its cache key, and the resolved route.
   * @throws RemoteError `disabled`, `rejected-text`, `no-model`, or `cancelled`.
   */
  private prepare(request: TranslateRequest, signal: AbortSignal): PreparedCall {
    const config = this.values()
    if (!config.enabled) {
      throw new RemoteError('selection-translate/disabled', 'selection-translate is disabled in this profile', {
        hint: 'Enable the plugin row (config.enabled) in the DSH profile patch.',
      })
    }
    const text = typeof request?.text === 'string' ? request.text : ''
    const chars = text.length
    if (chars < config.minChars || chars > config.maxChars) {
      throw new RemoteError(
        'selection-translate/rejected-text',
        `selection of ${chars} characters is outside ${config.minChars}..${config.maxChars}`,
        { minChars: config.minChars, maxChars: config.maxChars, chars },
      )
    }
    const route = this.route(config)
    if (route === undefined) {
      throw new RemoteError('selection-translate/no-model', 'no provider/model route is configured for translation', {
        hint: 'Set config.model to "provider/model", or configure a default model in DSH settings.',
      })
    }
    const requested = typeof request?.targetLanguage === 'string' ? request.targetLanguage : AUTO_LANGUAGE
    const targetLanguage = isExplicitLanguage(requested)
      ? requested.trim()
      : isExplicitLanguage(config.targetLanguage)
        ? config.targetLanguage.trim()
        : DEFAULT_TARGET_LANGUAGE
    if (signal.aborted) {
      throw new RemoteError('selection-translate/model-failed', 'translation was cancelled', { reason: 'cancelled' })
    }
    // The prompt now depends on the source language, the style, and the custom
    // instructions, so all three join the cache identity: a style edit must not
    // keep serving answers written under the previous instruction.
    const key = cacheKey(text, targetLanguage, route.label, config.sourceLanguage, config.style, config.customInstructions)
    return { config, text, chars, route, targetLanguage, key }
  }

  /**
   * Run one provider call, yielding its text deltas.
   *
   * A direct `ctx.llm.stream()` call is one attempt with no agent loop around
   * it, so every failure mode is normalized here instead of being retried. The
   * generator's return value is the finished, trimmed translation — the same
   * string the unary endpoint returns.
   * @param call - validated request, route, and prompt inputs.
   * @param signal - cancellation.
   * @yields each non-empty model text delta, in order.
   * @returns the trimmed translation.
   * @throws RemoteError when the route is unavailable or the call fails.
   */
  private async *streamText(call: PreparedCall, signal: AbortSignal): AsyncGenerator<string, string> {
    const llm = resolveLlm(this.ctx)
    if (llm === undefined) {
      throw new RemoteError('selection-translate/no-model', 'this deployment serves no llm service', {
        hint: 'Mount an LLM provider row (for example @deepseek-ai/dsh-llm-pi-ai) in this profile.',
      })
    }
    const { config, route, text, targetLanguage } = call
    const profile = {
      sourceLanguage: config.sourceLanguage,
      targetLanguage,
      style: config.style,
      customInstructions: config.customInstructions,
    }
    const messages: RequestMessage[] = [
      { role: 'user', content: [{ type: 'text', text: buildUserPrompt(text, profile) }] },
    ]
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      system: buildSystemPrompt(profile),
      messages,
      temperature: 0,
      maxTokens: config.maxOutputTokens,
      signal,
    }
    let output = ''
    let failure: string | undefined
    try {
      for await (const chunk of llm.stream(options)) {
        // Checked per chunk, not only after the loop: a cancellation while the
        // generator is suspended on a `yield` must end the answer at the next
        // item instead of delivering the rest of a stream nobody is reading.
        if (signal.aborted) {
          throw new RemoteError('selection-translate/model-failed', 'translation was cancelled', { reason: 'cancelled' })
        }
        const typed: StreamChunk = chunk
        if (typed.type === 'text-delta') {
          output += typed.text
          if (typed.text !== '') yield typed.text
        } else if (typed.type === 'finish' && (typed.reason.kind === 'error' || typed.reason.kind === 'aborted')) {
          failure = `${typed.reason.kind}: ${typed.reason.failure?.message ?? 'model call failed'}`
        }
      }
    } catch (error) {
      if (signal.aborted) {
        throw new RemoteError('selection-translate/model-failed', 'translation was cancelled', { reason: 'cancelled' })
      }
      throw new RemoteError('selection-translate/model-failed', messageOf(error), { reason: 'threw' })
    }
    if (signal.aborted) {
      throw new RemoteError('selection-translate/model-failed', 'translation was cancelled', { reason: 'cancelled' })
    }
    if (failure !== undefined) {
      throw new RemoteError('selection-translate/model-failed', failure, { reason: failure })
    }
    const translation = output.trim()
    if (translation === '') {
      throw new RemoteError('selection-translate/model-failed', 'the model returned no text', { reason: 'empty' })
    }
    return translation
  }

  /**
   * Drain {@link streamText} for callers that want the finished answer only.
   * @param call - validated request, route, and prompt inputs.
   * @param signal - cancellation.
   * @returns the trimmed translation.
   */
  private async run(call: PreparedCall, signal: AbortSignal): Promise<string> {
    const generator = this.streamText(call, signal)
    for (;;) {
      const next = await generator.next()
      if (next.done === true) return next.value
    }
  }
}

export { SelectionTranslateService }
