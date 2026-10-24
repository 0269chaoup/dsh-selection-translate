/**
 * The Typert method spec shared by both artifacts.
 *
 * DSH's Typert pipeline normally *generates* two files from the Host FaceModel:
 * `lib/typert.host.js` (registered by `dsh-typert-loader`) and
 * `lib/typert.remote-client.js` (mounted by the browser through `ctx.remote.$mount`).
 * This package ships no build-time generator, so the same spec is authored by
 * hand here and instantiated twice with `createTypertRemoteInfo`, exactly the
 * shape the generator emits (see
 * `@deepseek-ai/dsh-experimental-client-ui-cot-translation/lib/typert.host.js`).
 *
 * Keeping one spec in one module is what stops the two faces from drifting:
 * the Host descriptor and the Client contribution are built from the same
 * objects, so a wire field can never exist on one side only.
 *
 * @module dsh-selection-translate/typert.spec
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

import {
  LIMITS_ENDPOINT,
  PACKAGE,
  PROMPT_ENDPOINT,
  SERVICE_KEY,
  SETTINGS_ENDPOINT,
  STYLE_PRESETS,
  TRANSLATE_ENDPOINT,
  TRANSLATE_STREAM_ENDPOINT,
  type PromptPreview,
  type PromptPreviewRequest,
  type SaveSettingsRequest,
  type TranslateEvent,
  type TranslateLimits,
  type TranslateRequest,
  type TranslateResult,
  type TranslateSettingsPatch,
} from './shared.ts'

/** Result schema of `selectionTranslate/limits`. */
function limitsSchema(): z.ZodType<TranslateLimits> {
  return z.object({
    enabled: z.boolean().describe('Master switch; false hides the feature in the browser.'),
    sourceLanguage: z.string().describe('Source language tag, or "auto" to let the model detect it.'),
    targetLanguage: z.string().describe('Configured destination language, or "auto" to follow the interface language.'),
    style: z.enum(STYLE_PRESETS).describe('Translation style encoded into the system prompt.'),
    customInstructions: z.string().describe('Extra instruction block appended to the system prompt; empty for none.'),
    minChars: z.number().describe('Shortest selection that opens the button.'),
    maxChars: z.number().describe('Longest text one request accepts, in UTF-16 code units.'),
    model: z.string().describe('provider/model the next call will use, after resolving the default; empty when unresolved.'),
    modelOverride: z.string().describe('Raw config.model override; empty when the row follows the Host default model.'),
    namespace: z.string().describe('Settings namespace (the profile row id) a write must address; empty when unknown.'),
    revision: z.number().describe('Revision the next settings write is expected to match.'),
    writable: z.boolean().describe('Whether this deployment can persist a settings write.'),
  })
}

/** JSON Schema projection of the limits result, mirroring what the generator records. */
const LIMITS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    sourceLanguage: { type: 'string' },
    targetLanguage: { type: 'string' },
    style: { type: 'string', enum: [...STYLE_PRESETS] },
    customInstructions: { type: 'string' },
    minChars: { type: 'number' },
    maxChars: { type: 'number' },
    model: { type: 'string' },
    modelOverride: { type: 'string' },
    namespace: { type: 'string' },
    revision: { type: 'number' },
    writable: { type: 'boolean' },
  },
  required: [
    'enabled',
    'sourceLanguage',
    'targetLanguage',
    'style',
    'customInstructions',
    'minChars',
    'maxChars',
    'model',
    'modelOverride',
    'namespace',
    'revision',
    'writable',
  ],
  additionalProperties: false,
} as const

/**
 * Parameter schema of `selectionTranslate/translate` (ordinary view).
 *
 * Declared objects accept and strip unknown fields, which is the documented
 * behaviour of the ordinary codec.
 */
function translateRequestSchema(): z.ZodType<TranslateRequest> {
  return z.object({
    text: z.string().describe('Exact selection snapshot supplied by the browser.'),
    targetLanguage: z.string().describe('BCP 47 destination language, already resolved from "auto".'),
  })
}

/**
 * Strict view of the same parameter.
 *
 * The strict codec is what a call with `method.input({ strict: true })` parses,
 * so it rejects undeclared fields recursively instead of stripping them — the
 * shape the Typert generator emits for a declared object parameter.
 */
function translateRequestStrictSchema(): z.ZodType<TranslateRequest> {
  return z.strictObject({
    text: z.string().describe('Exact selection snapshot supplied by the browser.'),
    targetLanguage: z.string().describe('BCP 47 destination language, already resolved from "auto".'),
  })
}

/** Result schema of `selectionTranslate/translate`. */
function translateResultSchema(): z.ZodType<TranslateResult> {
  return z.object({
    translation: z.string().describe('Translated text; the model output with surrounding blank lines trimmed.'),
    targetLanguage: z.string().describe('Destination language actually used.'),
    model: z.string().describe('provider/model the Host called.'),
    cached: z.boolean().describe('Whether the answer came from the Host cache instead of a model call.'),
    chars: z.number().describe('Source length in UTF-16 code units.'),
  })
}

/** JSON Schema projection of the translate parameter. */
const TRANSLATE_REQUEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    targetLanguage: { type: 'string' },
  },
  required: ['text', 'targetLanguage'],
  additionalProperties: false,
} as const

/** JSON Schema projection of the translate result. */
const TRANSLATE_RESULT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    translation: { type: 'string' },
    targetLanguage: { type: 'string' },
    model: { type: 'string' },
    cached: { type: 'boolean' },
    chars: { type: 'number' },
  },
  required: ['translation', 'targetLanguage', 'model', 'cached', 'chars'],
  additionalProperties: false,
} as const

/**
 * Item schema of `selectionTranslate/translateStream`.
 *
 * A discriminated union keeps the two items apart on the wire: `delta` carries
 * text to append, `done` carries the authoritative result.
 */
function translateEventSchema(): z.ZodType<TranslateEvent> {
  return z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('delta').describe('Item carrying the next slice of model output.'),
      text: z.string().describe('Text to append to the answer received so far.'),
    }),
    z.object({
      kind: z.literal('done').describe('Terminal item of one translation stream.'),
      result: translateResultSchema().describe('The finished result, identical to the unary answer.'),
    }),
  ])
}

/** JSON Schema projection of a stream item. */
const TRANSLATE_EVENT_JSON_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'delta' },
        text: { type: 'string' },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'done' },
        result: TRANSLATE_RESULT_JSON_SCHEMA,
      },
      required: ['kind', 'result'],
      additionalProperties: false,
    },
  ],
} as const

/**
 * Fields of a settings patch, in the ordinary view.
 *
 * Every field is optional on purpose: a patch names only what changed, and the
 * Host merges it over the live values before validating the result.
 */
function settingsPatchSchema(): z.ZodType<TranslateSettingsPatch> {
  return z.object({
    enabled: z.boolean().optional().describe('Master switch.'),
    sourceLanguage: z.string().optional().describe('Source language tag, or "auto".'),
    targetLanguage: z.string().optional().describe('Destination language tag, or "auto".'),
    style: z.enum(STYLE_PRESETS).optional().describe('Translation style.'),
    customInstructions: z.string().optional().describe('Extra instruction block; empty clears it.'),
    model: z.string().optional().describe('provider/model override; empty follows the Host default.'),
    minChars: z.number().optional().describe('Shortest accepted selection.'),
    maxChars: z.number().optional().describe('Longest accepted selection.'),
    cacheSize: z.number().optional().describe('Host cache entries; 0 disables it.'),
    maxOutputTokens: z.number().optional().describe('Output-token ceiling of one call.'),
  })
}

/** Strict view of the same patch: an undeclared field is an error, not a silent drop. */
function settingsPatchStrictSchema(): z.ZodType<TranslateSettingsPatch> {
  return z.strictObject({
    enabled: z.boolean().optional().describe('Master switch.'),
    sourceLanguage: z.string().optional().describe('Source language tag, or "auto".'),
    targetLanguage: z.string().optional().describe('Destination language tag, or "auto".'),
    style: z.enum(STYLE_PRESETS).optional().describe('Translation style.'),
    customInstructions: z.string().optional().describe('Extra instruction block; empty clears it.'),
    model: z.string().optional().describe('provider/model override; empty follows the Host default.'),
    minChars: z.number().optional().describe('Shortest accepted selection.'),
    maxChars: z.number().optional().describe('Longest accepted selection.'),
    cacheSize: z.number().optional().describe('Host cache entries; 0 disables it.'),
    maxOutputTokens: z.number().optional().describe('Output-token ceiling of one call.'),
  })
}

/** JSON Schema projection of the settings patch. */
const SETTINGS_PATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    sourceLanguage: { type: 'string' },
    targetLanguage: { type: 'string' },
    style: { type: 'string', enum: [...STYLE_PRESETS] },
    customInstructions: { type: 'string' },
    model: { type: 'string' },
    minChars: { type: 'number' },
    maxChars: { type: 'number' },
    cacheSize: { type: 'number' },
    maxOutputTokens: { type: 'number' },
  },
  additionalProperties: false,
} as const

/** Parameter schema of `selectionTranslate/settings`. */
function saveSettingsRequestSchema(): z.ZodType<SaveSettingsRequest> {
  return z.object({
    patch: settingsPatchSchema().describe('Config fields to change; omitted fields keep their value.'),
    expectedRevision: z.number().describe('Revision the form was built from; a stale write is refused.'),
  })
}

/** Strict view of the same parameter. */
function saveSettingsRequestStrictSchema(): z.ZodType<SaveSettingsRequest> {
  return z.strictObject({
    patch: settingsPatchStrictSchema().describe('Config fields to change; omitted fields keep their value.'),
    expectedRevision: z.number().describe('Revision the form was built from; a stale write is refused.'),
  })
}

/** JSON Schema projection of the settings parameter. */
const SAVE_SETTINGS_REQUEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    patch: SETTINGS_PATCH_JSON_SCHEMA,
    expectedRevision: { type: 'number' },
  },
  required: ['patch', 'expectedRevision'],
  additionalProperties: false,
} as const

/** Parameter schema of `selectionTranslate/prompt`. */
function promptPreviewRequestSchema(): z.ZodType<PromptPreviewRequest> {
  return z.object({
    sample: z.string().describe('Sample text the preview renders into the user message.'),
    draft: settingsPatchSchema().describe('Configuration draft the preview pretends is saved.'),
    resolvedTargetLanguage: z
      .string()
      .describe('Browser-resolved concrete destination language; empty when unknown.'),
  })
}

/** Strict view of the same parameter. */
function promptPreviewRequestStrictSchema(): z.ZodType<PromptPreviewRequest> {
  return z.strictObject({
    sample: z.string().describe('Sample text the preview renders into the user message.'),
    draft: settingsPatchStrictSchema().describe('Configuration draft the preview pretends is saved.'),
    resolvedTargetLanguage: z
      .string()
      .describe('Browser-resolved concrete destination language; empty when unknown.'),
  })
}

/** JSON Schema projection of the prompt parameter. */
const PROMPT_PREVIEW_REQUEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    sample: { type: 'string' },
    draft: SETTINGS_PATCH_JSON_SCHEMA,
    resolvedTargetLanguage: { type: 'string' },
  },
  required: ['sample', 'draft', 'resolvedTargetLanguage'],
  additionalProperties: false,
} as const

/** Result schema of `selectionTranslate/prompt`. */
function promptPreviewSchema(): z.ZodType<PromptPreview> {
  return z.object({
    system: z.string().describe('System message text of one translation.'),
    user: z.string().describe('User message text with the sample wrapped in the delimiters.'),
  })
}

/** JSON Schema projection of the prompt result. */
const PROMPT_PREVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    system: { type: 'string' },
    user: { type: 'string' },
  },
  required: ['system', 'user'],
  additionalProperties: false,
} as const

/** Strict codec of one ordinary JSON value, built from a Zod factory. */
function jsonCodec<T>(typeSymbol: string, create: () => z.ZodType<T>, jsonSchema: Record<string, unknown>, description: string) {
  return {
    mode: 'strict' as const,
    typeSymbol,
    description,
    create,
    jsonSchema,
  }
}

/**
 * Build the lazy Remote info instance both artifacts export.
 *
 * Zod is passed explicitly because the runtime factory keeps no import of its
 * own: the published leaf is pure, and each artifact supplies its own runtime.
 * @returns a mountable/registrable info instance for this package's methods.
 */
export function createSelectionTranslateRemote() {
  return createTypertRemoteInfo(
    {
      package: PACKAGE,
      methods: {
        [LIMITS_ENDPOINT]: {
          service: SERVICE_KEY,
          description:
            'Read the effective selection-translate limits, settings state, and destination language without sending any text.',
          invocation: { kind: 'direct' },
          parameters: [],
          cancellation: { parameter: 'signal' },
          result: jsonCodec<TranslateLimits>(
            `${PACKAGE}#selectionTranslate/limits:result`,
            limitsSchema,
            LIMITS_JSON_SCHEMA,
            'effective switch, languages, style, selection bounds, model route, and settings revision.',
          ),
        },
        [TRANSLATE_ENDPOINT]: {
          service: SERVICE_KEY,
          description: 'Translate one selected fragment through the Host\'s configured model route.',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'request',
              description: 'selection snapshot and destination language supplied by the browser.',
              source: 'json',
              codec: jsonCodec<TranslateRequest>(
                `${PACKAGE}#selectionTranslate/translate:parameter:request`,
                translateRequestSchema,
                TRANSLATE_REQUEST_JSON_SCHEMA,
                'exact text to translate and the resolved destination language.',
              ),
              strictCodec: jsonCodec<TranslateRequest>(
                `${PACKAGE}#selectionTranslate/translate:parameter:request:strict`,
                translateRequestStrictSchema,
                TRANSLATE_REQUEST_JSON_SCHEMA,
                'exact text to translate and the resolved destination language.',
              ),
            },
          ],
          cancellation: { parameter: 'signal' },
          result: jsonCodec<TranslateResult>(
            `${PACKAGE}#selectionTranslate/translate:result`,
            translateResultSchema,
            TRANSLATE_RESULT_JSON_SCHEMA,
            'translated text, the language used, the model route, and whether it was cached.',
          ),
        },
        [TRANSLATE_STREAM_ENDPOINT]: {
          service: SERVICE_KEY,
          description: 'Translate one selected fragment, yielding each model text delta and then the finished result.',
          mode: 'stream',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'request',
              description: 'selection snapshot and destination language supplied by the browser.',
              source: 'json',
              codec: jsonCodec<TranslateRequest>(
                `${PACKAGE}#selectionTranslate/translateStream:parameter:request`,
                translateRequestSchema,
                TRANSLATE_REQUEST_JSON_SCHEMA,
                'exact text to translate and the resolved destination language.',
              ),
              strictCodec: jsonCodec<TranslateRequest>(
                `${PACKAGE}#selectionTranslate/translateStream:parameter:request:strict`,
                translateRequestStrictSchema,
                TRANSLATE_REQUEST_JSON_SCHEMA,
                'exact text to translate and the resolved destination language.',
              ),
            },
          ],
          cancellation: { parameter: 'signal' },
          result: jsonCodec<TranslateEvent>(
            `${PACKAGE}#selectionTranslate/translateStream:result`,
            translateEventSchema,
            TRANSLATE_EVENT_JSON_SCHEMA,
            'one stream item: a text delta, or the terminal result.',
          ),
        },
        [SETTINGS_ENDPOINT]: {
          service: SERVICE_KEY,
          description: 'Persist row config changes through the Host settings service and return the effective limits.',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'request',
              description: 'config patch and the settings revision the form was built from.',
              source: 'json',
              codec: jsonCodec<SaveSettingsRequest>(
                `${PACKAGE}#selectionTranslate/settings:parameter:request`,
                saveSettingsRequestSchema,
                SAVE_SETTINGS_REQUEST_JSON_SCHEMA,
                'fields to change and the revision the caller expects.',
              ),
              strictCodec: jsonCodec<SaveSettingsRequest>(
                `${PACKAGE}#selectionTranslate/settings:parameter:request:strict`,
                saveSettingsRequestStrictSchema,
                SAVE_SETTINGS_REQUEST_JSON_SCHEMA,
                'fields to change and the revision the caller expects.',
              ),
            },
          ],
          cancellation: { parameter: 'signal' },
          result: jsonCodec<TranslateLimits>(
            `${PACKAGE}#selectionTranslate/settings:result`,
            limitsSchema,
            LIMITS_JSON_SCHEMA,
            'the limits that are effective after the write.',
          ),
        },
        [PROMPT_ENDPOINT]: {
          service: SERVICE_KEY,
          description: 'Render the system and user prompt a draft configuration would send, without calling a model.',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'request',
              description: 'sample text, configuration draft, and the browser-resolved destination language.',
              source: 'json',
              codec: jsonCodec<PromptPreviewRequest>(
                `${PACKAGE}#selectionTranslate/prompt:parameter:request`,
                promptPreviewRequestSchema,
                PROMPT_PREVIEW_REQUEST_JSON_SCHEMA,
                'sample, draft fields, and the resolved destination language.',
              ),
              strictCodec: jsonCodec<PromptPreviewRequest>(
                `${PACKAGE}#selectionTranslate/prompt:parameter:request:strict`,
                promptPreviewRequestStrictSchema,
                PROMPT_PREVIEW_REQUEST_JSON_SCHEMA,
                'sample, draft fields, and the resolved destination language.',
              ),
            },
          ],
          cancellation: { parameter: 'signal' },
          result: jsonCodec<PromptPreview>(
            `${PACKAGE}#selectionTranslate/prompt:result`,
            promptPreviewSchema,
            PROMPT_PREVIEW_JSON_SCHEMA,
            'the system and user messages of one translation.',
          ),
        },
      },
    },
    z as unknown as typeof import('zod').z,
  )
}
