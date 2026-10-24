/**
 * The selection-translate overlay entry.
 *
 * Registered into `shell.overlay` — the shell's additive, click-through overlay
 * list. The entry therefore owns its own hit testing: the layer is transparent
 * to pointer events and only the button and the card accept them, so the
 * conversation below keeps scrolling, selecting, and clicking exactly as it
 * would without the plugin.
 *
 * The card head carries a gear that opens the same configuration form the
 * plugin row's page shows, so a reader can change the direction or the style
 * without leaving the conversation.
 *
 * @module dsh-selection-translate/client/overlay
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { TranslateEvent, TranslateLimits, TranslateRequest, TranslateResult } from '../shared.ts'
import { copyText } from './clipboard.ts'
import { ConfigPanel } from './config-panel.tsx'
import type { RemoteFailureLike, RemoteStreamLike, SelectionTranslateRemote } from './contracts.ts'
import { record } from './debug.ts'
import { describeFailure, type DescribedFailure } from './failure.ts'
import { messagesFor, resolveLocale, type Messages } from './i18n.ts'
import { destinationLanguage } from './language.ts'
import { insideOverlay, readSelectionAnchor, type SelectionAnchor } from './selection.ts'
import { OVERLAY_ATTRIBUTE, STYLE_ELEMENT_ATTRIBUTE, STYLES } from './styles.ts'
import { editableFromLimits, useSelectionSettings } from './use-settings.ts'

/** What the layer needs from the plugin activation. */
export interface OverlayApi {
  /** Mounted Remote namespace. */
  readonly remote: SelectionTranslateRemote
}

/** One user-visible step of the popup. */
type Phase = 'ready' | 'loading' | 'done' | 'error'

/** Props of the registered entry: this plugin's face plus the framework's unused kit. */
export interface OverlayProps {
  /** Injected by the registering factory in `client/index.tsx`. */
  readonly api?: OverlayApi
  /** Child-slot renderer supplied by the framework; unused by this entry. */
  readonly renderSlot?: unknown
  /** Remaining framework/owner props; unused by this entry. */
  readonly [key: string]: unknown
}

/** Longest a copy confirmation stays latched, in milliseconds. */
const COPIED_LATCH_MS = 1600

/** Height of the reading area when the viewport leaves room for it, in pixels. */
const BODY_MAX_HEIGHT = 232

/** Smallest useful reading area, in pixels. */
const BODY_MIN_HEIGHT = 88

/** Card chrome outside the reading area (head + meta + hairlines), in pixels. */
const CARD_CHROME_HEIGHT = 100

// ---------------------------------------------------------------- icon glyphs
//
// Drawn inline instead of imported: a third-party Client bundle may only reach
// React, so the chrome is a handful of 13px stroke paths on `currentColor`.

/** Copy-to-clipboard glyph. */
function IconCopy(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="5.75" y="5.75" width="6.75" height="6.75" rx="1.6" />
      <path d="M10.25 3.5H4.6A1.6 1.6 0 0 0 3 5.1v5.65" strokeLinecap="round" />
    </svg>
  )
}

/** Confirmation glyph: the copy control becomes this for a moment. */
function IconCheck(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Settings glyph: two sliders read as "form" without a gear's visual noise. */
function IconSliders(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 5h10M3 11h10" strokeLinecap="round" />
      <circle cx="6.5" cy="5" r="1.6" />
      <circle cx="10" cy="11" r="1.6" />
    </svg>
  )
}

/** Close glyph. */
function IconClose(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** Retry glyph. */
function IconRetry(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M13 4.5v3.2H9.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4 7.7A4.6 4.6 0 1 0 8 12.6" strokeLinecap="round" />
    </svg>
  )
}

/** Warning glyph for the error head. */
function IconAlert(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5.2v3.6" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r=".75" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Read one stream failure.
 *
 * The logical-stream carrier reports a Host throw as an `error` frame whose
 * payload is the same `{ code, message }` shape a unary call folds into its error
 * branch, so the card can word both paths with one dictionary; anything else
 * (a carrier fault, a missing terminal item) falls back to the generic failure.
 * @param error - whatever ended the stream.
 * @param messages - active dictionary.
 * @returns the headline and optional diagnostic to render.
 */
function describeStreamFailure(error: unknown, messages: Messages): DescribedFailure {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown }
    if (typeof candidate.code === 'string' && candidate.code !== '' && typeof candidate.message === 'string') {
      return describeFailure(candidate as RemoteFailureLike, messages)
    }
  }
  return {
    title: messages.failed,
    detail: error instanceof Error ? error.message : String(error),
  }
}

/**
 * The overlay entry component.
 * @param props - injected Remote face plus the framework kit (unused).
 * @returns the popup layer, or nothing while the Host reports the feature off.
 */
export function SelectionTranslateOverlay(props: OverlayProps): ReactNode {
  const locale = useMemo(() => resolveLocale(), [])
  const messages = useMemo(() => messagesFor(locale), [locale])
  const api = props.api
  const [limits, setLimits] = useState<TranslateLimits | null>(null)
  const [limitsFailure, setLimitsFailure] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Text received so far from the streaming endpoint. Empty while the model has
  // not produced anything yet, which is what distinguishes "still waiting" from
  // "writing": the first shows a skeleton, the second shows the text.
  const [partial, setPartial] = useState('')
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({ top: true, bottom: true })

  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<RemoteStreamLike<TranslateEvent> | null>(null)
  /** Whether the reading area is parked at the bottom; see the follow effect. */
  const followRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // One record per mount: proves the entry reached React at all, which is the
  // difference between "the slot never rendered" and "the Host said no".
  useEffect(() => {
    record('overlay/mounted', { hasApi: api !== undefined })
  }, [api])

  /** Cancel whatever call is running and close (or replace) the popup. */
  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    // Closing is also the cancel path of a running stream: dropping the handle
    // closes the Host generator, which stops the provider call.
    streamRef.current?.dispose?.()
    streamRef.current = null
    setPhase('ready')
    setResult(null)
    setFailure(null)
    setCopied(false)
    setSettingsOpen(false)
    setPartial('')
    setAnchor(null)
  }, [])

  // Effective limits, read once per mount from the Host.
  useEffect(() => {
    if (api === undefined) {
      record('limits/no-api')
      setLimitsFailure(messages.unknown)
      return
    }
    const controller = new AbortController()
    record('limits/request', { arity: api.remote.limits.length })
    let settled = false
    const pendingTimer = window.setTimeout(() => {
      if (!settled) record('limits/still-pending')
    }, 4000)
    // `Promise.resolve().then(...)` rather than a direct call: a *synchronous*
    // throw inside the Remote method would otherwise escape the effect and leave
    // the card invisible with no trace of why.
    void Promise.resolve()
      .then(() => api.remote.limits(controller.signal))
      .then(
        (outcome) => {
          settled = true
          window.clearTimeout(pendingTimer)
          if (controller.signal.aborted) return
          if (outcome.ok) {
            record('limits/ok', outcome.value)
            setLimits(outcome.value)
            return
          }
          record('limits/failed', outcome.error)
          setLimitsFailure(describeFailure(outcome.error, messages).title)
        },
        (error: unknown) => {
          settled = true
          window.clearTimeout(pendingTimer)
          record('limits/threw', error)
          setLimitsFailure(messages.unknown)
        },
      )
    return () => {
      window.clearTimeout(pendingTimer)
      controller.abort()
    }
  }, [api, messages])

  // Selection listeners: the plugin's whole entry point into the page.
  useEffect(() => {
    if (limits === null || !limits.enabled) return
    const minChars = limits.minChars
    record('listeners/armed', { minChars })

    const detect = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) return
      if (insideOverlay(selection.anchorNode)) return
      const next = readSelectionAnchor(minChars)
      record('detect', next === null ? 'no-anchor' : { chars: next.text.length })
      if (next === null) return
      setPhase('ready')
      setResult(null)
      setFailure(null)
      setCopied(false)
      setSettingsOpen(false)
      setAnchor(next)
    }

    const onPointerUp = (event: MouseEvent): void => {
      // A press inside this overlay is the user driving the popup, not a new selection.
      if (insideOverlay(event.target as Node | null)) return
      // The selection finalizes after mouseup on some platforms (double-click,
      // triple-click, drag-release), so read it on the next task.
      window.setTimeout(detect, 0)
    }
    const onSelectionChange = (): void => {
      if (insideOverlay(document.activeElement)) return
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) return
      if (insideOverlay(selection.anchorNode)) return
      window.setTimeout(detect, 120)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') return
      if (event.shiftKey || event.key === 'a' || event.key === 'A') window.setTimeout(detect, 0)
    }
    /** A stored viewport rectangle goes stale the moment the page moves. */
    const onViewportChange = (event: Event): void => {
      if (insideOverlay(event.target as Node | null)) return
      setAnchor(null)
      setSettingsOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (insideOverlay(event.target as Node | null)) return
      // A press elsewhere dismisses the card, exactly like a click-outside.
      setAnchor(null)
      setSettingsOpen(false)
    }

    document.addEventListener('mouseup', onPointerUp, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('keydown', onEscape, true)
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('mouseup', onPointerUp, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('keydown', onEscape, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [limits, close])

  /**
   * Consume the streaming endpoint for one call.
   *
   * The endpoint is optional: a Host that does not publish it leaves the card
   * on the unary path, and a stream that fails before its first delta does the
   * same, so a missing or broken stream never leaves the reader without an
   * answer.
   * @param input - validated request for the anchored text.
   * @param controller - lifetime of this call.
   * @returns true when the card reached a final state; false to fall back.
   */
  const streamOnce = useCallback(
    async (input: TranslateRequest, controller: AbortController): Promise<boolean> => {
      if (api === undefined) return false
      const open = api.remote.translateStream
      if (typeof open !== 'function') return false
      let sawDelta = false
      try {
        const handle = open.call(api.remote, input, controller.signal)
        if (typeof (handle as Partial<AsyncIterable<TranslateEvent>>)[Symbol.asyncIterator] !== 'function') {
          record('translate/stream-unavailable')
          return false
        }
        streamRef.current = handle
        for await (const event of handle) {
          if (controller.signal.aborted) return true
          if (event.kind === 'delta') {
            sawDelta = true
            setPartial((previous) => previous + event.text)
            continue
          }
          record('translate/stream-done', { chars: event.result.translation.length })
          streamRef.current = null
          // The terminal result is authoritative (the Host trimmed it), so the
          // streamed buffer is dropped instead of being compared with it.
          setPartial('')
          setResult(event.result)
          setPhase('done')
          return true
        }
        throw new Error('the translation stream ended without a result')
      } catch (error) {
        streamRef.current = null
        if (controller.signal.aborted) return true
        record('translate/stream-failed', error)
        if (!sawDelta) return false
        // Part of the answer is already on screen: report the failure instead of
        // silently restarting a call the reader is watching.
        setPartial('')
        setFailure(describeStreamFailure(error, messages))
        setPhase('error')
        return true
      }
    },
    [api, messages],
  )

  /** Run one translation for the anchored text. */
  const translate = useCallback(
    async (current: SelectionAnchor) => {
      if (api === undefined || limits === null) return
      abortRef.current?.abort()
      streamRef.current?.dispose?.()
      streamRef.current = null
      const controller = new AbortController()
      abortRef.current = controller
      record('translate/request', { chars: current.text.length, stream: typeof api.remote.translateStream === 'function' })
      setPhase('loading')
      setFailure(null)
      setResult(null)
      setCopied(false)
      setSettingsOpen(false)
      setPartial('')
      const targetLanguage = destinationLanguage(limits.targetLanguage)
      const input: TranslateRequest = { text: current.text, targetLanguage }

      if (await streamOnce(input, controller)) return
      if (controller.signal.aborted) return

      // Fallback path: the unary endpoint, which is also what a Host without the
      // stream endpoint answers.
      try {
        const outcome = await api.remote.translate(input, controller.signal)
        if (controller.signal.aborted) return
        if (outcome.ok) {
          record('translate/ok')
          setPartial('')
          setResult(outcome.value)
          setPhase('done')
          return
        }
        record('translate/failed', outcome.error)
        setFailure(describeFailure(outcome.error, messages))
        setPhase('error')
      } catch (error) {
        if (controller.signal.aborted) return
        record('translate/threw', error)
        setFailure({
          title: messages.failed,
          detail: error instanceof Error ? error.message : String(error),
        })
        setPhase('error')
      }
    },
    [api, limits, messages, streamOnce],
  )

  /** Re-read the scroll position so the two edge fades track the content. */
  const syncEdges = useCallback(() => {
    const element = scrollRef.current
    if (element === null) {
      setEdges({ top: true, bottom: true })
      return
    }
    const atTop = element.scrollTop <= 1
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1
    followRef.current = atBottom
    setEdges((previous) => (previous.top === atTop && previous.bottom === atBottom ? previous : { top: atTop, bottom: atBottom }))
  }, [])

  // A new answer (or a resize of the reading area) changes which edges hide
  // content, so the fades are recomputed whenever the text is replaced.
  useEffect(() => {
    syncEdges()
  }, [syncEdges, phase, result, settingsOpen, anchor])

  // Follow the model while it writes, but only while the reader is already at
  // the bottom: scrolling up mid-answer must not be undone by the next delta.
  useEffect(() => {
    if (phase !== 'loading') return
    const element = scrollRef.current
    if (element === null || !followRef.current) return
    element.scrollTop = element.scrollHeight
  }, [phase, partial])

  // The copy confirmation is latched, not sticky: it says "done" for long enough
  // to be read, then returns the control to its idle label.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_LATCH_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  // The preview is only meaningful against real text: once a translation exists,
  // the anchored selection is the sample the prompt will see in practice.
  const sample = result !== null && anchor !== null ? anchor.text : 'Hello, world.'
  const settings = useSelectionSettings({
    remote: api?.remote,
    limits,
    messages,
    sample,
    onSaved: (value) => {
      // The panel stays open on purpose: the save status has to be readable
      // where the user made the edit, and closing the panel would take it away
      // together with the form. The user closes it (✕, Esc, a click outside).
      setLimits(value)
    },
  })

  if (limitsFailure !== null) {
    record('render/suppressed-by-limits-failure', limitsFailure)
    return null
  }
  if (limits === null || !limits.enabled) return null

  const showCard = anchor !== null && phase !== 'ready'
  const bodyMaxHeight =
    anchor === null
      ? BODY_MAX_HEIGHT
      : Math.max(BODY_MIN_HEIGHT, Math.min(BODY_MAX_HEIGHT, anchor.cardMaxHeight - CARD_CHROME_HEIGHT))
  const announcement = copied ? messages.copied : phase === 'error' ? (failure?.title ?? messages.failed) : ''

  return (
    <div className="dsh-st-layer" {...{ [OVERLAY_ATTRIBUTE]: 'layer' }} dir="auto">
      <style {...{ [STYLE_ELEMENT_ATTRIBUTE]: 'layer' }}>{STYLES}</style>
      {anchor !== null && phase === 'ready' ? (
        <button
          type="button"
          className="dsh-st-button"
          style={{ top: anchor.buttonTop, left: anchor.buttonLeft }}
          // Keeping the selection alive is the whole trick: without this the
          // mousedown collapses it before the click handler runs.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void translate(anchor)}
          title={messages.button}
        >
          <span className="dsh-st-button-mark" aria-hidden="true">
            {locale === 'zh' ? '文' : 'A'}
          </span>
          <span className="dsh-st-button-label">{messages.button}</span>
          <span
            className="dsh-st-button-pointer"
            data-side={anchor.pointer}
            style={{ left: anchor.pointerLeft }}
            aria-hidden="true"
          />
        </button>
      ) : null}
      {showCard && anchor !== null ? (
        <div
          className={`dsh-st-card${settingsOpen ? ' dsh-st-card-settings' : ''}`}
          role="dialog"
          aria-label={messages.button}
          style={{
            top: anchor.cardTop,
            left: anchor.cardLeft,
            width: anchor.cardWidth,
            ...(settingsOpen ? {} : { maxHeight: anchor.cardMaxHeight }),
          }}
          {...{ 'data-dsh-selection-translate': 'off' }}
        >
          <div className="dsh-st-head">
            <span className="dsh-st-head-text">
              <span className="dsh-st-eyebrow">{messages.cardEyebrow}</span>
              <span
                className={`dsh-st-title${
                  phase === 'error' ? ' dsh-st-title-error' : phase === 'loading' ? ' dsh-st-title-muted' : ''
                }`}
              >
                {phase === 'loading'
                  ? messages.loading
                  : phase === 'error'
                    ? messages.failed
                    : messages.targetOf(result?.targetLanguage ?? '')}
              </span>
            </span>
            <span className="dsh-st-acts">
              {phase === 'done' ? (
                <button
                  type="button"
                  className={`dsh-st-iconbtn${copied ? ' dsh-st-iconbtn-ok' : ''}`}
                  title={copied ? messages.copied : messages.copy}
                  aria-label={copied ? messages.copied : messages.copy}
                  onClick={() => {
                    void copyText(result?.translation ?? '').then((ok) => {
                      if (ok) setCopied(true)
                    })
                  }}
                >
                  {copied ? <IconCheck /> : <IconCopy />}
                </button>
              ) : null}
              <button
                type="button"
                className="dsh-st-iconbtn"
                title={messages.settingsTitle}
                aria-label={messages.settingsTitle}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <IconSliders />
              </button>
              <button
                type="button"
                className="dsh-st-iconbtn"
                onClick={close}
                title={messages.close}
                aria-label={messages.close}
              >
                <IconClose />
              </button>
            </span>
          </div>
          <div className="dsh-st-body">
            <div
              className="dsh-st-scrollwrap"
              data-at-top={edges.top ? 'true' : 'false'}
              data-at-bottom={edges.bottom ? 'true' : 'false'}
            >
              <div
                className="dsh-st-scroll"
                ref={scrollRef}
                onScroll={syncEdges}
                style={settingsOpen ? undefined : { maxHeight: bodyMaxHeight }}
              >
                {phase === 'loading' ? (
                  <>
                    {partial === '' ? (
                      <div className="dsh-st-skel" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      <div className="dsh-st-text">
                        {partial}
                        <span className="dsh-st-caret" aria-hidden="true" />
                      </div>
                    )}
                    <div className="dsh-st-loadingbar">
                      <span className="dsh-st-spinner" aria-hidden="true" />
                      {messages.loading}
                      <button
                        type="button"
                        className="dsh-st-btn dsh-st-btn-ghost dsh-st-btn-sm"
                        style={{ marginLeft: 'auto' }}
                        onClick={close}
                      >
                        {messages.cancel}
                      </button>
                    </div>
                  </>
                ) : phase === 'error' ? (
                  <div className="dsh-st-error">
                    <div className="dsh-st-error-head">
                      <IconAlert />
                      {failure?.title ?? messages.failed}
                    </div>
                    {failure?.detail !== undefined ? (
                      <div className="dsh-st-error-detail">{failure.detail}</div>
                    ) : null}
                    <div className="dsh-st-error-actions">
                      <button
                        type="button"
                        className="dsh-st-btn dsh-st-btn-secondary dsh-st-btn-sm"
                        onClick={() => void translate(anchor)}
                      >
                        <IconRetry />
                        {messages.retry}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="dsh-st-text">{result?.translation ?? ''}</div>
                )}
              </div>
            </div>
          </div>
          {settingsOpen ? (
            <ConfigPanel
              locale={locale}
              messages={messages}
              value={editableFromLimits(limits)}
              writable={settings.writable}
              busy={settings.busy}
              status={settings.status}
              statusKind={settings.statusKind}
              effectiveModel={limits.model}
              preview={settings.preview}
              onEdit={() => settings.clearStatus()}
              onSave={(next, diff) => {
                void settings.save(next, diff)
              }}
              onPreview={(next) => {
                void settings.showPreview(next)
              }}
            />
          ) : null}
          {phase === 'done' && result !== null && !settingsOpen ? (
            <div className="dsh-st-foot">
              {result.cached ? (
                <span className="dsh-st-foot-cache">
                  <span aria-hidden="true">⚡</span>
                  {messages.cachedHit}
                </span>
              ) : null}
              {result.cached ? <span className="dsh-st-foot-div" aria-hidden="true" /> : null}
              <span className="dsh-st-foot-model" title={messages.modelHint(result.model)}>
                {result.model}
              </span>
              <span className="dsh-st-foot-counts">{`${result.chars} → ${result.translation.length}`}</span>
            </div>
          ) : null}
          <span className="dsh-st-sr" role="status" aria-live="polite">
            {announcement}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default SelectionTranslateOverlay
