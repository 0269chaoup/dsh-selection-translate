/**
 * Browser module of the selection-translate plugin.
 *
 * The shell loads this bundle into the page module table and calls `apply` with
 * the Client root context. The module does three things, in this order:
 *
 * 1. mount the Host-for-Client Remote contribution, which installs
 *    `ctx.remote.selectionTranslate.*` for this fiber (and withdraws it on unload);
 * 2. register one entry into `shell.overlay`, the shell's additive full-frame
 *    overlay list, so the popup renders above the conversation without taking
 *    the conversation over;
 * 3. register the row's configuration page into `plugins.row.config`, keyed by
 *    the row id the Host reports.
 *
 * `shell.overlay` is deliberately not the `root` slot: `root` is a single-
 * occupancy slot owned by the layout framework, and registering there replaces
 * the whole ui-layout frame.
 *
 * @module dsh-selection-translate/client
 */

import { DEFAULT_NAMESPACE, PACKAGE } from '../shared.ts'
import { TYPERT_REMOTE } from '../typert.remote.ts'
import { REMOTE_NAMESPACE, type ClientContext, type SelectionTranslateRemote } from './contracts.ts'
import { record } from './debug.ts'
import { SelectionTranslateOverlay } from './overlay.tsx'
import { SelectionTranslateSettingsPage } from './settings-page.tsx'

/** Entry id inside `shell.overlay`; unique per plugin, not per render. */
const OVERLAY_ENTRY_ID = 'selection-translate'

/** Order among overlay entries; this layer is decorative and yields to host chrome. */
const OVERLAY_ORDER = 900

/**
 * Cordis service key of the namespace this plugin mounts.
 *
 * `$mount` installs it as a child service of `remote`, so the *service* key is
 * dotted; the namespace name on `ctx.remote` is the bare one.
 */
const NAMESPACE_SERVICE_KEY = `remote.${REMOTE_NAMESPACE}`

/**
 * Client services this bundle requires before `apply` runs.
 *
 * `remote` is the API Gateway client face that `$mount` belongs to, and `slots`
 * is the slot dispatcher the overlay entry registers into. Both are ordered
 * through `dsh.client.inject` in `package.json` as well.
 */
export const inject: readonly string[] = ['slots', 'remote']

/**
 * Activate the browser half.
 * @param ctx - Client root context.
 * @returns fulfillment once the Remote contribution and the slot entries are installed.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  record('apply/start')
  // A shell that serves no Remote face or no slot dispatcher must lose the
  // feature, never the GUI: a throwing `apply` is a plugin the shell reports and
  // may take down with it.
  if (ctx.remote === undefined || ctx.slots === undefined) {
    record('apply/no-services', { remote: ctx.remote !== undefined, slots: ctx.slots !== undefined })
    ctx.logger?.warn?.('[selection-translate] the Client serves no remote/slots service; feature stays off')
    return
  }

  let disposeRemote: () => Promise<void>
  try {
    disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  } catch (error) {
    record('apply/mount-failed', error)
    throw error
  }
  record('apply/remote-mounted')
  ctx.effect(() => () => {
    void disposeRemote()
  }, 'selection-translate: remote contribution')

  // The namespace is a *child service* of `remote`, and Cordis resolves child
  // services only for a fiber that declares them: touching
  // `ctx.remote.selectionTranslate` from this fiber throws
  // `cannot get property "remote.selectionTranslate" without inject`. The
  // namespace cannot be declared in this plugin's own `inject` either — it does
  // not exist until `$mount` above resolves, so the entry would wait forever on
  // itself. The shell's own packages solve this the same way: mount first, then
  // register the UI inside `ctx.inject(['remote.<namespace>'], …)`, which re-runs
  // (and unregisters) whenever the namespace appears or is withdrawn.
  const api = await new Promise<{ remote: SelectionTranslateRemote }>((resolve, reject) => {
    const scope = ctx.inject(['remote', NAMESPACE_SERVICE_KEY], (child) => {
      const remote = child.remote?.[REMOTE_NAMESPACE] as SelectionTranslateRemote | undefined
      if (remote === undefined) {
        reject(new Error(`selection-translate: Remote namespace "${REMOTE_NAMESPACE}" is not mounted`))
        return
      }
      record('apply/namespace-ok')
      resolve({ remote })
      return () => record('apply/namespace-withdrawn')
    })
    ctx.effect(() => () => {
      void scope.dispose()
    }, 'selection-translate: namespace scope')
  })

  // The entry receives the framework props; this wrapper adds the capability the
  // component needs. `api` is built once per activation so the object identity
  // stays stable across renders — the overlay keys its effects on it, and a
  // fresh object per render would re-run them on every state change.
  const Entry = (props: Record<string, unknown>) => <SelectionTranslateOverlay {...props} api={api} />
  const SettingsPageEntry = (props: Record<string, unknown>) => <SelectionTranslateSettingsPage {...props} api={api} />

  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () => {
        record('apply/slot-declared')
        return ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ENTRY_ID, order: OVERLAY_ORDER }, Entry)
      }),
    'selection-translate: overlay entry',
  )

  // The row id is a Host fact — a profile may rename the row — and the Plugins
  // page addresses this row's configuration by it, so it is read from the Host
  // before the entry is keyed. The default keeps the page reachable when the
  // call fails, which is exactly when someone wants to fix the configuration.
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void api.remote
      .limits(new AbortController().signal)
      .then((outcome) => {
        if (cancelled) return
        const rowId = outcome.ok && outcome.value.namespace !== '' ? outcome.value.namespace : DEFAULT_NAMESPACE
        record('apply/row-config', { key: `${PACKAGE}#${rowId}` })
        dispose = ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register({ name: 'plugins.row.config', key: `${PACKAGE}#${rowId}` }, SettingsPageEntry),
        )
      })
      .catch((error: unknown) => record('apply/row-config-failed', error))
    return () => {
      cancelled = true
      dispose?.()
    }
  }, 'selection-translate: plugins row config')

  record('apply/slot-inject-armed')
}

export default { inject, apply }
