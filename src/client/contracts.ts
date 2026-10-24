/**
 * Minimal contracts for the browser half.
 *
 * A Client plugin bundle is plain JavaScript at runtime: the Host serves the
 * compiled file and the shell loads it into the page, so there is no type check
 * on the way in. These interfaces therefore describe only the exact seats this
 * plugin touches, instead of importing the whole Client service graph (which a
 * third-party package cannot pin anyway).
 *
 * @module dsh-selection-translate/client/contracts
 */

import type {
  PromptPreview,
  PromptPreviewRequest,
  SaveSettingsRequest,
  TranslateEvent,
  TranslateLimits,
  TranslateRequest,
  TranslateResult,
} from '../shared.ts'

/** One Remote failure as it reaches the browser: a stable code plus a diagnostic message. */
export interface RemoteFailureLike {
  readonly code: string
  readonly message: string
}

/**
 * What every unary Remote call resolves to.
 *
 * The Remote face folds carrier failures into the error branch, so a caller
 * never wraps the call to recover an offline Host.
 */
export type RemoteResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailureLike }

/**
 * One open Remote stream as the browser holds it.
 *
 * The carrier hands back the downlink items as an `AsyncIterable` plus the
 * disposal of the same logical stream; only `dispose` is used here, because the
 * uplink is `never` on this endpoint.
 */
export interface RemoteStreamLike<Item> extends AsyncIterable<Item> {
  /** Cancel the logical stream; the Host's generator is closed. */
  dispose?(): void
}

/** Methods installed by `$mount` for this package's namespace. */
export interface SelectionTranslateRemote {
  /** Read the effective settings, languages, and selection bounds. */
  limits(signal?: AbortSignal): Promise<RemoteResultLike<TranslateLimits>>
  /** Translate one selected fragment. */
  translate(request: TranslateRequest, signal?: AbortSignal): Promise<RemoteResultLike<TranslateResult>>
  /**
   * Stream one translation as text deltas followed by the finished result.
   *
   * Optional on purpose: the method only exists once a Host publishes the
   * stream endpoint, so the card feature-detects it and falls back to
   * {@link translate} rather than showing a broken answer.
   */
  translateStream?(request: TranslateRequest, signal?: AbortSignal): RemoteStreamLike<TranslateEvent>
  /** Persist row config changes through the Host settings service. */
  saveSettings(request: SaveSettingsRequest, signal?: AbortSignal): Promise<RemoteResultLike<TranslateLimits>>
  /** Render the prompt a draft configuration would send. */
  describePrompt(request: PromptPreviewRequest, signal?: AbortSignal): Promise<RemoteResultLike<PromptPreview>>
}

/** The `ctx.remote` face this plugin uses: one mount plus one namespace lookup. */
export interface ClientRemoteFace {
  /** Mount a Host-for-Client contribution in the calling fiber; resolves to its disposer. */
  $mount(contribution: unknown): Promise<() => Promise<void>>
  /** Namespace services installed by mounted contributions. */
  readonly [namespace: string]: unknown
}

/**
 * One slot registration.
 *
 * List slots order entries by `id` + `order`; keyed slots (the Plugins page's
 * configuration seats) address an entry by `key` instead, which is why both
 * groups are optional here rather than required.
 */
export interface SlotRegistrationOptions {
  readonly name: string
  /** List-slot identity. */
  readonly id?: string
  /** List-slot order. */
  readonly order?: number
  /** Keyed-slot identity, e.g. `<package>#<row id>`. */
  readonly key?: string
  readonly label?: string | (() => string)
}

/** The `ctx.slots` face this plugin uses. */
export interface SlotsFace {
  /** Register an entry into a slot the calling entry has already declared. */
  register(options: SlotRegistrationOptions, component: unknown): () => void
  /** Run `callback` once the owning entry declares `key`; returns the disposer. */
  inject(key: string, callback: () => (() => void) | void): () => void
}

/**
 * A Cordis child fiber, as far as this plugin needs it.
 *
 * `ctx.inject(deps, callback)` returns a fiber: it settles once the callback
 * finished loading, and disposing it unloads the callback.
 */
export interface ChildFiber {
  dispose(): Promise<void> | void
}

/**
 * The subset of the Client plugin context this bundle depends on.
 *
 * `inject` is how a plugin reaches a service it only learns about at runtime —
 * here the `remote.<namespace>` child service that `$mount` installs. Reading
 * such a child service from the plugin's own fiber throws
 * `cannot get property "…" without inject`, so the overlay is wired inside an
 * inject scope rather than straight from `apply`.
 */
export interface ClientContext {
  readonly slots: SlotsFace
  /** The Remote face; absent only in a shell that serves no Gateway. */
  readonly remote?: ClientRemoteFace
  /** Own a cleanup with this plugin's fiber. */
  effect(execute: () => (() => void) | void, label?: string): unknown
  /** Run `callback` once every listed service exists; returns the child fiber. */
  inject(deps: readonly string[], callback: (child: ClientContext) => (() => void) | void): ChildFiber
  /** Optional diagnostic sink. */
  readonly logger?: { warn?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void }
}

/** Namespace this package's contribution installs. */
export const REMOTE_NAMESPACE = 'selectionTranslate'
