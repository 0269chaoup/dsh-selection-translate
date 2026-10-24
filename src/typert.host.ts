/**
 * Host-face Typert artifact: `dsh-selection-translate/typert`.
 *
 * `@deepseek-ai/dsh-typert-loader` discovers every Loader entry, imports its
 * `./typert` export, validates the manifest, and registers the invocation
 * descriptors in `ctx.typert.local`. That registration is what lets the Host
 * Gateway answer a strict (schema-validated) call instead of falling back to
 * the descriptor-free source mode, and what lets a browser mount the matching
 * `./remote` contribution at all.
 *
 * The real DSH packages carry this file as generated output (`do not edit`). It
 * is authored here because this package has no build-time Typert generator; the
 * shape below matches the generated artifact byte for byte in the fields the
 * loader validates.
 *
 * @module dsh-selection-translate/typert.host
 */

import { createSelectionTranslateRemote } from './typert.spec.ts'
import {
  LIMITS_ENDPOINT,
  PACKAGE,
  PROMPT_ENDPOINT,
  SERVICE_KEY,
  SETTINGS_ENDPOINT,
  TRANSLATE_ENDPOINT,
  TRANSLATE_STREAM_ENDPOINT,
} from './shared.ts'

const $remote = createSelectionTranslateRemote()

/**
 * Manifest consumed by `dsh-typert-loader`.
 *
 * `face` must be `'host'`, `schemas` must be an array (this package declares no
 * extra named schemas), and every service entry carries the documentation the
 * registry exposes to tooling.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [] as readonly { readonly name: string; readonly create: () => unknown }[],
  get invocations() {
    return $remote.descriptors
  },
  model: {
    services: [
      {
        description: 'LLM translation of a text selection in the DSH Web GUI.',
        summary: 'LLM translation of a text selection in the DSH Web GUI.',
        tags: [] as readonly string[],
        jsDoc: '/** Host-side selection translation; the browser never holds a model credential. */',
        key: SERVICE_KEY,
        exportName: 'default',
        members: [
          {
            kind: 'method',
            name: 'limits',
            signature: '@Remote async limits(signal: AbortSignal): Promise<TranslateLimits>',
            summary: 'Read the effective limits and destination language without sending any text.',
          },
          {
            kind: 'method',
            name: 'translate',
            signature: '@Remote async translate(request: TranslateRequest, signal: AbortSignal): Promise<TranslateResult>',
            summary: "Translate one selected fragment through the Host's configured model route.",
          },
          {
            kind: 'method',
            name: 'translateStream',
            signature:
              '@Remote({ mode: \'stream\' }) translateStream(request: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateEvent>',
            summary: "Stream the translation of one selected fragment, yielding text deltas and then the finished result.",
          },
          {
            kind: 'method',
            name: 'saveSettings',
            signature: '@Remote async saveSettings(request: SaveSettingsRequest, signal: AbortSignal): Promise<TranslateLimits>',
            summary: 'Persist row config changes through the Host settings service and return the effective limits.',
          },
          {
            kind: 'method',
            name: 'describePrompt',
            signature: '@Remote async describePrompt(request: PromptPreviewRequest, signal: AbortSignal): Promise<PromptPreview>',
            summary: 'Render the prompt a draft configuration would send, without calling a model.',
          },
        ],
        types: [
          {
            name: 'TranslateLimits',
            declaration:
              'export interface TranslateLimits {\n    readonly enabled: boolean;\n    readonly sourceLanguage: string;\n    readonly targetLanguage: string;\n    readonly style: StylePreset;\n    readonly customInstructions: string;\n    readonly minChars: number;\n    readonly maxChars: number;\n    readonly model: string;\n    readonly modelOverride: string;\n    readonly namespace: string;\n    readonly revision: number;\n    readonly writable: boolean;\n}',
          },
          {
            name: 'TranslateRequest',
            declaration:
              'export interface TranslateRequest {\n    readonly text: string;\n    readonly targetLanguage: string;\n}',
          },
          {
            name: 'TranslateResult',
            declaration:
              'export interface TranslateResult {\n    readonly translation: string;\n    readonly targetLanguage: string;\n    readonly model: string;\n    readonly cached: boolean;\n    readonly chars: number;\n}',
          },
          {
            name: 'TranslateEvent',
            declaration:
              'export type TranslateEvent =\n    | {\n        readonly kind: \'delta\';\n        readonly text: string;\n    }\n    | {\n        readonly kind: \'done\';\n        readonly result: TranslateResult;\n    }',
          },
          {
            name: 'TranslateSettingsPatch',
            declaration:
              'export interface TranslateSettingsPatch {\n    readonly enabled?: boolean;\n    readonly sourceLanguage?: string;\n    readonly targetLanguage?: string;\n    readonly style?: StylePreset;\n    readonly customInstructions?: string;\n    readonly model?: string;\n    readonly minChars?: number;\n    readonly maxChars?: number;\n    readonly cacheSize?: number;\n    readonly maxOutputTokens?: number;\n}',
          },
          {
            name: 'SaveSettingsRequest',
            declaration:
              'export interface SaveSettingsRequest {\n    readonly patch: TranslateSettingsPatch;\n    readonly expectedRevision: number;\n}',
          },
          {
            name: 'PromptPreviewRequest',
            declaration:
              'export interface PromptPreviewRequest {\n    readonly sample: string;\n    readonly draft: TranslateSettingsPatch;\n    readonly resolvedTargetLanguage: string;\n}',
          },
          {
            name: 'PromptPreview',
            declaration:
              'export interface PromptPreview {\n    readonly system: string;\n    readonly user: string;\n}',
          },
        ],
      },
    ],
    events: [] as readonly unknown[],
    objects: [] as readonly unknown[],
  },
} as const

/** Endpoints this artifact publishes, for diagnostics and tests. */
export const TYPERT_ENDPOINTS = [
  LIMITS_ENDPOINT,
  TRANSLATE_ENDPOINT,
  TRANSLATE_STREAM_ENDPOINT,
  SETTINGS_ENDPOINT,
  PROMPT_ENDPOINT,
] as const

export default TYPERT
