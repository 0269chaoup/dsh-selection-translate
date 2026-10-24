/**
 * Offline smoke checks for the built artifacts.
 *
 * These run without a Harness, a browser, or a model provider. They verify the
 * four things a build alone cannot: that the Host bundle exposes a Cordis
 * Service class carrying every `@Remote` marker, that its config defaults and
 * its settings-service integration behave as documented (against a fake
 * settings service), that both Typert artifacts satisfy every rule
 * `dsh-typert-loader` enforces before it registers a manifest, and that the
 * Client bundle really is a module-loader factory whose `apply` mounts the
 * Remote contribution and registers both slot entries.
 *
 * What this cannot prove: that the Host composition accepts the row, that the
 * real settings service accepts the write, that the browser renders the popup,
 * and that a provider answers the model call.
 *
 * @module dsh-selection-translate/scripts/smoke
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** The loader's marker property, from `@deepseek-ai/dsh-typert-protocol`. */
const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Read one built Host artifact. */
const host = await import(join(root, 'lib/index.js'))
const typertHost = await import(join(root, 'lib/typert.host.js'))
const typertRemote = await import(join(root, 'lib/typert.remote.js'))

const signal = () => new AbortController().signal

// ---------------------------------------------------------------- Host service

const Service = host.default
assert.equal(typeof Service, 'function', 'lib/index.js must default-export the Service class')
assert.equal(Service.name, 'SelectionTranslateService')
assert.ok(Array.isArray(Service.inject), 'the Service must declare static inject')
assert.equal(typeof Service.Config, 'function', 'the Service must carry static Config (schemastery schema)')

// Volatile fields parse into live references, so the defaults are read through
// the same projection the service uses. `configValues` is the package's own
// unwrapping, not a test-only convenience.
const resolved = host.configValues(Service.Config({}))
assert.deepEqual(
  {
    enabled: resolved.enabled,
    sourceLanguage: resolved.sourceLanguage,
    targetLanguage: resolved.targetLanguage,
    style: resolved.style,
    customInstructions: resolved.customInstructions,
    model: resolved.model,
    minChars: resolved.minChars,
    maxChars: resolved.maxChars,
    cacheSize: resolved.cacheSize,
    maxOutputTokens: resolved.maxOutputTokens,
  },
  {
    enabled: true,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    style: 'fluent',
    customInstructions: '',
    model: '',
    minChars: 2,
    maxChars: 4000,
    cacheSize: 64,
    maxOutputTokens: 2048,
  },
  'config defaults must match the documented defaults',
)
assert.throws(() => Service.Config({ minChars: 0 }), /minChars|minimum|must/, 'minChars must reject 0')
assert.throws(() => Service.Config({ style: 'bogus' }), /style/, 'an unknown style must be refused')
assert.throws(
  () => Service.Config({ customInstructions: 'x'.repeat(2001) }),
  /customInstructions/,
  'an over-long instruction block must be refused',
)

// The marker descriptor is installed by a decorator initializer, so it only
// exists once one instance has been constructed: mount the real plugin in a
// bare Cordis context, which is also the check that this class is a valid plugin.
const ctx = new Context()
const providerCalls = []
const fakeLlm = {
  async *stream(options) {
    providerCalls.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: ' 你好' }
    yield { type: 'text-delta', index: 0, text: '世界 ' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
ctx.provide('llm')
ctx.set('llm', fakeLlm)
await ctx.plugin(Service, { model: 'workbuddy/cn:deepseek-v4.1-flash' })
const service = ctx.get('selectionTranslate')
assert.equal(service?.constructor?.name, 'SelectionTranslateService', 'the row mounts under its service key')

const markers = Object.getOwnPropertyDescriptor(Service.prototype, DESCRIPTOR_KEY)
assert.ok(markers !== undefined, '@Remote must leave a marker descriptor on the prototype')
const remoteMarkers = remoteMethods(service)
const markerNames = remoteMarkers.map((marker) => marker.method).sort()
assert.deepEqual(
  markerNames,
  ['describePrompt', 'limits', 'saveSettings', 'translate', 'translateStream'],
  'every Remote method must carry a marker',
)
for (const marker of remoteMarkers) {
  assert.equal(marker.invocation.kind, 'direct', `${marker.method} must be a direct Remote`)
  if (marker.method === 'translateStream') {
    assert.equal(marker.mode, 'stream', 'translateStream must be declared as a stream Remote')
  } else {
    assert.equal(marker.mode, undefined, `${marker.method} must stay a unary Remote`)
  }
}

// -------------------------------------------- Host behaviour against a stub model

const first = await service.translate({ text: 'hello world', targetLanguage: 'zh-CN' }, signal())
assert.deepEqual(first, {
  translation: '你好世界',
  targetLanguage: 'zh-CN',
  model: 'workbuddy/cn:deepseek-v4.1-flash',
  cached: false,
  chars: 11,
})
const second = await service.translate({ text: 'hello world', targetLanguage: 'zh-CN' }, signal())
assert.equal(second.cached, true, 'the second identical call must be served from the cache')
assert.equal(providerCalls.length, 1, 'a cache hit must not reach the provider')

const sent = providerCalls[0]
assert.equal(sent.provider, 'workbuddy', 'the override provider reaches GenerateOptions')
assert.equal(sent.model, 'cn:deepseek-v4.1-flash', 'the override model reaches GenerateOptions')
assert.equal(sent.maxTokens, 2048, 'the configured output ceiling reaches GenerateOptions')
assert.match(sent.system, /Output ONLY the translation/, 'the prompt forbids commentary')
assert.match(
  sent.system,
  /Translate the user message from English into Simplified Chinese\./,
  'the configured direction is stated in the first sentence',
)
assert.match(sent.system, /\n6\. Write the way a native speaker/, 'the fluent style rule is rule 6')
assert.ok(!/\n7\./.test(sent.system), 'no rule 7 without custom instructions')
assert.deepEqual(
  sent.messages,
  [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Translate the text between the markers from English into Simplified Chinese. Output only the translation.\n<text_to_translate>\nhello world\n</text_to_translate>',
        },
      ],
    },
  ],
  'the user prompt restates the direction next to the text',
)

// `auto` in the request means "use the configured destination", not "guess".
const autoTarget = await service.translate({ text: 'second line', targetLanguage: 'auto' }, signal())
assert.equal(autoTarget.targetLanguage, 'zh-CN', 'a request-level auto falls back to the configured target')
assert.equal(providerCalls.length, 2)

const limits = await service.limits(signal())
assert.deepEqual(
  limits,
  {
    enabled: true,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    style: 'fluent',
    customInstructions: '',
    minChars: 2,
    maxChars: 4000,
    model: 'workbuddy/cn:deepseek-v4.1-flash',
    modelOverride: 'workbuddy/cn:deepseek-v4.1-flash',
    namespace: 'selection-translate',
    revision: 0,
    writable: false,
  },
  'a deployment without a settings service reports its default row id and no writable state',
)

await assert.rejects(
  () => service.translate({ text: 'x', targetLanguage: 'zh' }, signal()),
  (error) => error.code === 'selection-translate/rejected-text',
  'a too-short selection is refused with a typed code',
)

// ------------------------------------------------------- Host streaming endpoint

// The stream endpoint shares the prompt, cache and guards of the unary one; what
// it adds is delivery. A consumer must see the model's deltas in order and then
// exactly one terminal item carrying the same result the unary call returns.
const streamEvents = []
for await (const event of service.translateStream({ text: 'stream me', targetLanguage: 'zh-CN' }, signal())) {
  streamEvents.push(event)
}
assert.ok(streamEvents.length >= 3, 'a streamed answer carries its deltas and a terminal item')
assert.equal(streamEvents.at(-1).kind, 'done', 'the last item is the terminal result')
const streamedDeltas = streamEvents.slice(0, -1)
assert.ok(
  streamedDeltas.every((event) => event.kind === 'delta'),
  'no item other than the last one is terminal',
)
assert.deepEqual(
  streamedDeltas.map((event) => event.text),
  [' 你好', '世界 '],
  'each provider delta reaches the browser as its own item, untrimmed and in order',
)
assert.deepEqual(
  streamEvents.at(-1).result,
  {
    translation: '你好世界',
    targetLanguage: 'zh-CN',
    model: 'workbuddy/cn:deepseek-v4.1-flash',
    cached: false,
    chars: 9,
  },
  'the terminal result matches what the unary endpoint would have returned',
)
assert.equal(providerCalls.length, 3, 'the streaming call reached the provider once')

// A cached answer still streams, as one delta plus the terminal item: the card
// then needs no second code path for an instant answer.
const providerCallsBeforeCachedStream = providerCalls.length
const cachedEvents = []
for await (const event of service.translateStream({ text: 'stream me', targetLanguage: 'zh-CN' }, signal())) {
  cachedEvents.push(event)
}
assert.equal(cachedEvents.length, 2, 'a cache hit streams one delta plus the result')
assert.deepEqual(cachedEvents[0], { kind: 'delta', text: '你好世界' }, 'the cached answer is one delta')
assert.equal(cachedEvents[1].result.cached, true, 'the terminal item reports the cache hit')
assert.equal(providerCalls.length, providerCallsBeforeCachedStream, 'a cache hit must not reach the provider')

// A consumer that walks away mid-answer (Esc, a new selection) closes the
// provider stream and leaves no half answer behind.
const abandoned = service.translateStream({ text: 'abandoned before the end', targetLanguage: 'zh-CN' }, signal())
await abandoned.next()
await abandoned.return('')
const afterAbandon = await service.translate({ text: 'abandoned before the end', targetLanguage: 'zh-CN' }, signal())
assert.equal(afterAbandon.cached, false, 'an abandoned stream must not cache a partial answer')
assert.equal(afterAbandon.translation, '你好世界', 'the abandoned text still translates on the next call')

// Cancellation mid-stream is the same typed failure the unary endpoint raises.
const midStream = new AbortController()
const cancelledStream = service.translateStream({ text: 'cancel this one', targetLanguage: 'zh-CN' }, midStream.signal)
await cancelledStream.next()
midStream.abort()
await assert.rejects(
  () => cancelledStream.next(),
  (error) => error.code === 'selection-translate/model-failed' && /cancel/i.test(error.message),
  'an aborted stream ends with the typed cancellation failure',
)

// A provider that fails must surface a typed failure, not a bare rejection.
const failingCtx = new Context()
failingCtx.provide('llm')
failingCtx.set('llm', {
  async *stream() {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider exploded' } } }
  },
})
await failingCtx.plugin(Service, { model: 'workbuddy/cn:deepseek-v4.1-flash' })
await assert.rejects(
  () => failingCtx.get('selectionTranslate').translate({ text: 'hello', targetLanguage: 'zh' }, signal()),
  (error) => error.code === 'selection-translate/model-failed' && /provider exploded/.test(error.message),
)

// A deployment without a model route answers a typed refusal instead of throwing at load.
const emptyCtx = new Context()
await emptyCtx.plugin(Service, {})
await assert.rejects(
  () => emptyCtx.get('selectionTranslate').translate({ text: 'hello', targetLanguage: 'zh' }, signal()),
  (error) => error.code === 'selection-translate/no-model',
)
assert.deepEqual(
  host.parseModelRoute('workbuddy/cn:deepseek-v4.1-flash'),
  { provider: 'workbuddy', model: 'cn:deepseek-v4.1-flash' },
  'provider/model parsing must split on the first slash',
)
assert.equal(host.parseModelRoute(''), undefined)
assert.equal(host.parseModelRoute('noprovider'), undefined)

// -------------------------------------------------- Settings service integration

// A deployment without a settings service must still answer `limits()` and must
// refuse a write with the code the panel words as "edit cordis.patch.yml".
const noSettings = emptyCtx.get('selectionTranslate')
const noSettingsLimits = await noSettings.limits(signal())
assert.equal(noSettingsLimits.writable, false, 'no settings service means no writable settings')
assert.equal(noSettingsLimits.namespace, 'selection-translate', 'the default row id is still reported')
await assert.rejects(
  () => noSettings.saveSettings({ patch: { style: 'literal' }, expectedRevision: 0 }, signal()),
  (error) => error.code === 'selection-translate/settings-failed' && /no settings service/.test(error.message),
  'a deployment without a settings service refuses the write with a typed code',
)

// A fake settings service, shaped like the shipped one: `describe()` returns the
// rows of the current profile and `update()` refuses a stale revision.
const settingsCtx = new Context()
const writes = []
let revision = 3
let rejectRevision = undefined
const fakeSettings = {
  describe() {
    return [{ ns: 'selection-translate', revision, writable: true, value: {}, base: {}, user: {} }]
  },
  async update(ns, patch, expectedRevision) {
    writes.push({ ns, patch, expectedRevision })
    if (rejectRevision !== undefined) throw rejectRevision
    if (expectedRevision !== revision) {
      throw new Error(`settings namespace "${ns}" changed since it was read (expected revision ${expectedRevision}, now ${revision})`)
    }
    revision += 1
  },
}
settingsCtx.provide('settings')
settingsCtx.set('settings', fakeSettings)
await settingsCtx.plugin(Service, { model: 'workbuddy/cn:deepseek-v4.1-flash' })
const withSettings = settingsCtx.get('selectionTranslate')

const before = await withSettings.limits(signal())
assert.equal(before.writable, true, 'a settings service makes the row writable')
assert.equal(before.revision, 3, 'the revision comes from describe()')

const savedLimits = await withSettings.saveSettings(
  { patch: { style: 'literal', customInstructions: 'Keep API names in English.' }, expectedRevision: 3 },
  signal(),
)
assert.deepEqual(
  writes[0],
  {
    ns: 'selection-translate',
    patch: { style: 'literal', customInstructions: 'Keep API names in English.' },
    expectedRevision: 3,
  },
  'the write carries only the changed fields, to the row id, with the expected revision',
)
assert.equal(savedLimits.style, 'literal', 'the returned limits reflect the written style')
assert.equal(savedLimits.customInstructions, 'Keep API names in English.')
assert.equal(savedLimits.namespace, 'selection-translate')
assert.equal(savedLimits.revision, 4, 'the returned limits carry the revision after the write')
assert.equal(savedLimits.writable, true)

// Nothing changed: no write is attempted at all. (The stub service cannot commit
// the written values back into the running config the way the Cordis loader
// does, so this restates a value that is already current.)
const writesBefore = writes.length
const unchanged = await withSettings.saveSettings({ patch: { targetLanguage: 'zh-CN' }, expectedRevision: revision }, signal())
assert.equal(writes.length, writesBefore, 'a patch that changes nothing must not reach the settings service')
assert.equal(unchanged.revision, revision)

await assert.rejects(
  () => withSettings.saveSettings({ patch: { style: 'technical' }, expectedRevision: 1 }, signal()),
  (error) =>
    error.code === 'selection-translate/settings-failed' && /expected revision 1, now 4/.test(error.message),
  'a stale revision is refused and its diagnostic text is carried through',
)

await assert.rejects(
  () => withSettings.saveSettings({ patch: { style: 'bogus' }, expectedRevision: 4 }, signal()),
  (error) => error.code === 'selection-translate/settings-failed' && /style/.test(error.message),
  'an invalid value is refused before it reaches the settings service',
)

rejectRevision = new Error('the profile document is not writable')
await assert.rejects(
  () => withSettings.saveSettings({ patch: { maxChars: 6000 }, expectedRevision: 4 }, signal()),
  (error) => error.code === 'selection-translate/settings-failed' && /not writable/.test(error.message),
)
rejectRevision = undefined

const technical = await withSettings.describePrompt(
  {
    sample: 'Hello, world.',
    draft: { style: 'technical', targetLanguage: 'zh-CN', sourceLanguage: 'en' },
    resolvedTargetLanguage: 'zh-CN',
  },
  signal(),
)
assert.match(technical.system, /keep established technical terms/, 'the draft style reaches the system prompt')
assert.match(technical.system, /from English into Simplified Chinese/, 'the draft direction reaches the system prompt')
assert.match(technical.user, /<text_to_translate>\nHello, world\.\n<\/text_to_translate>/, 'the sample is wrapped')
assert.match(technical.user, /from English into Simplified Chinese/, 'the user prompt restates the direction')

const custom = await withSettings.describePrompt(
  {
    sample: 'Deploy it.',
    draft: { customInstructions: 'Prefer short sentences.\nKeep names verbatim.' },
    resolvedTargetLanguage: '',
  },
  signal(),
)
assert.match(custom.system, /7\. Additional instructions from the user, which win over the rules above where they conflict:/)
assert.match(custom.system, /Prefer short sentences\.\nKeep names verbatim\./, 'custom instructions keep their line breaks')

// `auto` source in the draft drops the direction clause instead of naming a language.
const detected = await withSettings.describePrompt(
  { sample: 'Hello.', draft: { sourceLanguage: 'auto' }, resolvedTargetLanguage: '' },
  signal(),
)
assert.match(detected.system, /into Simplified Chinese, detecting the source language\./)
assert.ok(!/from English/.test(detected.system), 'an auto source names no source language')

// ------------------------------------------------------------- Typert manifest

/** Re-implementation of the loader's `requireStrictCodec`, for the fields it inspects. */
function assertStrictCodec(codec, subject) {
  assert.equal(typeof codec, 'object', `${subject} must be an object`)
  assert.equal(codec.mode, 'strict', `${subject} must be a strict codec`)
  assert.equal(typeof codec.typeSymbol, 'string', `${subject} needs a typeSymbol`)
  assert.ok(codec.typeSymbol.length > 0, `${subject} typeSymbol must not be empty`)
  assert.equal(typeof codec.create, 'function', `${subject} needs a create() factory`)
  if (codec.jsonSchema !== undefined) {
    assert.equal(typeof codec.jsonSchema, 'object', `${subject} jsonSchema must be an object`)
  }
}

// What `validateTypertManifest()` checks before a manifest enters the registry.
const TYPERT = typertHost.TYPERT
assert.equal(TYPERT.package, manifest.name, 'TYPERT.package must equal the exporting package name')
assert.equal(TYPERT.face, 'host', 'TYPERT.face must be "host"')
assert.ok(Array.isArray(TYPERT.schemas), 'TYPERT.schemas must be an array')
assert.equal(typeof TYPERT.model, 'object')
assert.ok(Array.isArray(TYPERT.model.services), 'TYPERT.model.services must be an array')
assert.ok(Array.isArray(TYPERT.model.events), 'TYPERT.model.events must be an array')
assert.ok(Array.isArray(TYPERT.model.objects), 'TYPERT.model.objects must be an array')

for (const service of TYPERT.model.services) {
  assert.equal(service.key, 'selectionTranslate', 'the registered service key must match the Service name')
  assert.equal(service.exportName, 'default')
  assert.ok(Array.isArray(service.tags))
  assert.ok(Array.isArray(service.members) && service.members.length === 5, 'the service documents five methods')
  for (const member of service.members) {
    assert.ok(['method', 'property', 'getter', 'event'].includes(member.kind), `${member.name} kind`)
    assert.equal(typeof member.signature, 'string')
    assert.ok(markerNames.includes(member.name), `${member.name} must name a real @Remote method`)
  }
  for (const type of service.types) {
    assert.equal(typeof type.name, 'string')
    assert.equal(typeof type.declaration, 'string')
  }
  assert.deepEqual(
    service.types.map((type) => type.name),
    [
      'TranslateLimits',
      'TranslateRequest',
      'TranslateResult',
      'TranslateEvent',
      'TranslateSettingsPatch',
      'SaveSettingsRequest',
      'PromptPreviewRequest',
      'PromptPreview',
    ],
    'every wire type is documented',
  )
}

const invocations = TYPERT.invocations
assert.ok(Array.isArray(invocations) && invocations.length === 5, 'five invocations are published')
const byEndpoint = new Map(invocations.map((invocation) => [`${invocation.namespace}/${invocation.method}`, invocation]))
assert.deepEqual([...byEndpoint.keys()].sort(), [
  'selectionTranslate/describePrompt',
  'selectionTranslate/limits',
  'selectionTranslate/saveSettings',
  'selectionTranslate/translate',
  'selectionTranslate/translateStream',
])
assert.deepEqual(
  [...typertHost.TYPERT_ENDPOINTS].sort(),
  [...byEndpoint.keys()].sort(),
  'the diagnostics list matches the published endpoints',
)

for (const invocation of invocations) {
  const id = `${invocation.namespace}/${invocation.method}`
  for (const key of ['id', 'service', 'namespace', 'method']) {
    assert.equal(typeof invocation[key], 'string', `${id}.${key}`)
    assert.ok(invocation[key].length > 0, `${id}.${key} must not be empty`)
  }
  assert.equal(invocation.service, 'selectionTranslate', `${id} must resolve through ctx.get("selectionTranslate")`)
  assert.equal(invocation.invocation.kind, 'direct', `${id} must be a direct receiver`)
  assert.ok(markerNames.includes(invocation.method), `${id} must have a matching @Remote marker`)
  assert.equal(invocation.cancellation.parameter, 'signal', `${id} must be cancellation-aware`)
  assert.ok(Array.isArray(invocation.parameters))
  const wires = new Set()
  for (const parameter of invocation.parameters) {
    assert.equal(typeof parameter.name, 'string')
    assert.equal(typeof parameter.wire, 'string')
    assert.ok(!wires.has(parameter.wire), `${id} repeats wire field ${parameter.wire}`)
    wires.add(parameter.wire)
    assert.ok(['json', 'lookup'].includes(parameter.source), `${id} parameter source`)
    assertStrictCodec(parameter.codec, `${id} parameter ${parameter.wire} codec`)
    assertStrictCodec(parameter.strictCodec, `${id} parameter ${parameter.wire} strictCodec`)
    // The strict view must be able to build its own parser.
    assert.equal(typeof parameter.strictCodec.create().parse, 'function')
  }
  assertStrictCodec(invocation.result, `${id} result`)
  assert.equal(typeof invocation.result.create().parse, 'function')
  assert.equal(typeof invocation.input, 'function', `${id} needs a generated input() selector`)
  assert.equal(typeof invocation.invoke, 'function', `${id} needs a generated invoke()`)
}

const translate = byEndpoint.get('selectionTranslate/translate')
assert.deepEqual(
  translate.parameters.map((parameter) => parameter.wire),
  ['request'],
  'translate takes one named request parameter',
)
const requestSchema = translate.parameters[0].strictCodec.create()
assert.equal(typeof requestSchema.parse, 'function')
assert.deepEqual(requestSchema.parse({ text: 'hello', targetLanguage: 'zh-CN' }), { text: 'hello', targetLanguage: 'zh-CN' })
assert.throws(() => requestSchema.parse({ text: 'hello' }), /targetLanguage|required/i, 'targetLanguage is required')
// Strictness is a property of the generated named-input view, not of the
// per-parameter schema: the Gateway builds `zod.strictObject` over the parameters.
const strictInput = translate.input({ strict: true }).create()
assert.throws(() => strictInput.parse({ request: { text: 'hi', targetLanguage: 'zh', extra: 1 } }), /extra|unrecognized/i)
assert.deepEqual(
  strictInput.parse({ request: { text: 'hi', targetLanguage: 'zh' } }),
  { request: { text: 'hi', targetLanguage: 'zh' } },
)
const lenientInput = translate.input().create()
assert.deepEqual(
  lenientInput.parse({ request: { text: 'hi', targetLanguage: 'zh', extra: 1 } }),
  { request: { text: 'hi', targetLanguage: 'zh' } },
  'the ordinary view strips undeclared fields',
)
assert.equal(translate.input({ strict: true }).jsonSchema.type, 'object')

// The settings and prompt parameters carry the same strict/ordinary split, and a
// nested patch is strict too: an undeclared config field must not be forwarded.
for (const endpoint of ['selectionTranslate/saveSettings', 'selectionTranslate/describePrompt']) {
  const invocation = byEndpoint.get(endpoint)
  assert.deepEqual(invocation.parameters.map((parameter) => parameter.wire), ['request'], `${endpoint} takes one request`)
  const strict = invocation.parameters[0].strictCodec.create()
  const ordinary = invocation.parameters[0].codec.create()
  assert.equal(typeof strict.parse, 'function')
  assert.equal(typeof ordinary.parse, 'function')
}
const strictSettings = byEndpoint.get('selectionTranslate/saveSettings').parameters[0].strictCodec.create()
assert.deepEqual(strictSettings.parse({ patch: { style: 'literal' }, expectedRevision: 3 }), {
  patch: { style: 'literal' },
  expectedRevision: 3,
})
assert.throws(() => strictSettings.parse({ patch: { style: 'bogus' }, expectedRevision: 3 }), /style|invalid/i)
assert.throws(() => strictSettings.parse({ patch: { nope: 1 }, expectedRevision: 3 }), /nope|unrecognized/i)
assert.throws(() => strictSettings.parse({ patch: {} }), /expectedRevision|required/i)
const strictPrompt = byEndpoint.get('selectionTranslate/describePrompt').parameters[0].strictCodec.create()
assert.deepEqual(strictPrompt.parse({ sample: 'x', draft: {}, resolvedTargetLanguage: 'zh-CN' }), {
  sample: 'x',
  draft: {},
  resolvedTargetLanguage: 'zh-CN',
})
assert.throws(() => strictPrompt.parse({ sample: 'x', draft: {} }), /resolvedTargetLanguage|required/i)

// The stream endpoint publishes the same request parameter and a stream-mode
// descriptor; the unary one must not claim stream mode.
const streamEndpoint = byEndpoint.get('selectionTranslate/translateStream')
assert.equal(streamEndpoint.mode, 'stream', 'translateStream must be a stream descriptor')
assert.equal(byEndpoint.get('selectionTranslate/translate').mode, undefined, 'translate must stay unary')
assert.deepEqual(
  streamEndpoint.parameters.map((parameter) => parameter.wire),
  ['request'],
  'translateStream takes the same single request parameter',
)
const streamItem = streamEndpoint.result.create()
assert.deepEqual(streamItem.parse({ kind: 'delta', text: 'hi' }), { kind: 'delta', text: 'hi' })
assert.equal(
  streamItem.parse({ kind: 'done', result: { translation: 'x', targetLanguage: 'zh', model: 'a/b', cached: false, chars: 1 } })
    .result.translation,
  'x',
  'the terminal item carries a full result',
)
assert.throws(() => streamItem.parse({ kind: 'delta' }), /text|required/i, 'a delta without text is refused')

const limitsResult = byEndpoint.get('selectionTranslate/limits').result.create()
const projected = limitsResult.parse({
  enabled: true,
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  style: 'fluent',
  customInstructions: '',
  minChars: 2,
  maxChars: 4000,
  model: 'x/y',
  modelOverride: '',
  namespace: 'selection-translate',
  revision: 0,
  writable: true,
})
assert.equal(projected.namespace, 'selection-translate', 'the limits result declares the settings namespace')
assert.throws(() => limitsResult.parse({ enabled: true }), /sourceLanguage|required/i)

// ------------------------------------------------------------ Typert client face

const contribution = typertRemote.default
assert.equal(contribution.package, manifest.name)
assert.ok(Array.isArray(contribution.descriptors) && contribution.descriptors.length === 5)
for (const method of ['limits', 'translate', 'translateStream', 'saveSettings', 'describePrompt']) {
  assert.equal(
    typeof contribution.methods[`selectionTranslate/${method}`].invoke,
    'function',
    `${method} must be mountable from the browser`,
  )
}

// --------------------------------------------------------------- Client module

const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')
assert.ok(clientSource.startsWith('window.__ModuleLoader__.load({'), 'the client bundle must open the module-loader envelope')
assert.ok(clientSource.includes(`id: ${JSON.stringify(manifest.name)}`), 'the module id must equal the package name')
// Bundled sources may mention these names in string constants (module ids,
// marker keys); what must not survive is a runtime module request for them.
for (const forbidden of [/require\("@deepseek-ai\/[^"]*"\)/, /from\s+"@deepseek-ai\/[^"]*"/, /require\("zod"\)/, /from\s+"zod"/]) {
  assert.ok(!forbidden.test(clientSource), `the client bundle must not request ${forbidden} at runtime`)
}

const externalRequests = [...clientSource.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
assert.deepEqual(
  [...new Set(externalRequests)].sort(),
  ['react', 'react/jsx-runtime'],
  'the client bundle may only ask the module table for React',
)

const reactStub = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => undefined,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
}
let moduleExports
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      assert.equal(id, manifest.name, 'the loader receives the package name as the module id')
      moduleExports = factory((specifier) => {
        if (specifier === 'react') return reactStub
        if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'fragment' }
        throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
      })
    },
  },
}

// The browser evaluates this file as a script; `new Function` gives it exactly
// that shape (its own scope, no imports, `window` from the global object).
new Function(clientSource)()

assert.equal(typeof moduleExports.apply, 'function', 'the client module must export apply')
assert.ok(Array.isArray(moduleExports.inject), 'the client module must export inject')
assert.deepEqual([...moduleExports.inject].sort(), ['remote', 'slots'], 'client inject declares the services it uses')

const calls = []
const cleanups = []
const clientCtx = {
  slots: {
    inject: (key, callback) => {
      calls.push(['inject', key])
      return callback()
    },
    register: (options, component) => {
      calls.push(['register', options.name, options.id ?? options.key, options.order, typeof component])
      return () => calls.push(['dispose-entry'])
    },
  },
  remote: {
    async $mount(contributionArg) {
      calls.push(['mount', contributionArg.package, contributionArg.descriptors.length])
      // Stand in for what $mount installs, so the inject scope finds the face.
      this.selectionTranslate = {
        limits: async () => ({
          ok: true,
          value: {
            enabled: true,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            style: 'fluent',
            customInstructions: '',
            minChars: 2,
            maxChars: 4000,
            model: 'x/y',
            modelOverride: '',
            namespace: 'selection-translate',
            revision: 3,
            writable: true,
          },
        }),
        translate: async () => ({ ok: true, value: { translation: 't', targetLanguage: 'en', model: 'x/y', cached: false, chars: 1 } }),
        saveSettings: async () => ({ ok: false, error: { code: 'selection-translate/settings-failed', message: 'x' } }),
        describePrompt: async () => ({ ok: true, value: { system: 's', user: 'u' } }),
      }
      return async () => calls.push(['unmount'])
    },
  },
  // Stand in for Cordis `ctx.inject(deps, callback)`: settle the child scope at
  // once with the same ctx, because the namespace is already installed by the
  // `$mount` stub above. The real runtime only calls the callback after the
  // child service exists and re-runs it when that service is withdrawn.
  inject: (deps, callback) => {
    calls.push(['scope', ...deps])
    const disposer = callback(clientCtx)
    return {
      dispose: async () => {
        if (typeof disposer === 'function') await disposer()
        calls.push(['scope-dispose', ...deps])
      },
    }
  },
  effect: (execute, label) => {
    const disposer = execute()
    if (typeof disposer === 'function') cleanups.push([label, disposer])
    return disposer
  },
  logger: { warn: (...args) => calls.push(['warn', ...args]) },
}

await moduleExports.apply(clientCtx)
// The row-config entry is keyed by a Host-reported row id, so it registers one
// microtask after `apply` returns (and after the limits call settles).
await new Promise((resolve) => setTimeout(resolve, 0))

assert.deepEqual(calls[0], ['mount', manifest.name, 5], 'apply must mount the contribution first')
assert.deepEqual(
  calls[1],
  ['scope', 'remote', 'remote.selectionTranslate'],
  'the namespace is reached through an inject scope, never by a bare property read',
)
assert.deepEqual(calls[2], ['inject', 'shell.overlay'], 'the overlay entry targets shell.overlay')
const overlayRegistration = calls[3]
assert.deepEqual(overlayRegistration.slice(0, 4), ['register', 'shell.overlay', 'selection-translate', 900])
assert.equal(overlayRegistration[4], 'function', 'the slot entry is a component factory')
assert.deepEqual(calls[4], ['inject', 'plugins.row.config'], 'the row configuration page targets plugins.row.config')
const rowRegistration = calls[5]
assert.deepEqual(
  rowRegistration.slice(0, 3),
  ['register', 'plugins.row.config', `${manifest.name}#selection-translate`],
  'the row page is keyed by <package>#<row id> as the Host reports it',
)
assert.equal(rowRegistration[4], 'function', 'the row page is a component factory')

// Disposal must release both entries and the Remote contribution.
for (const [, disposer] of cleanups.reverse()) await disposer()
assert.equal(
  calls.filter((call) => call[0] === 'dispose-entry').length,
  2,
  'both slot entries must be disposed',
)
assert.ok(calls.some((call) => call[0] === 'unmount'), 'the Remote contribution must be withdrawn')

process.stdout.write('smoke: all offline checks passed\n')
