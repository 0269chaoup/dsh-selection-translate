/**
 * Browser-face Typert artifact: `dsh-selection-translate/remote`.
 *
 * A Client plugin mounts this contribution with `ctx.remote.$mount(...)`, which
 * validates every parameter codec, registers the descriptors, and installs
 * `ctx.remote.selectionTranslate.limits()` / `.translate()` for the calling
 * fiber. The contribution carries no Host code and no credential: the browser
 * only ever sends the selected text over the same-origin Remote carrier.
 *
 * @module dsh-selection-translate/remote
 */

import { createSelectionTranslateRemote } from './typert.spec.ts'

/** Mountable Host-for-Client contribution of this package. */
export const TYPERT_REMOTE = createSelectionTranslateRemote()

export default TYPERT_REMOTE
