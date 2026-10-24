/**
 * User-facing text of the browser half.
 *
 * The dictionaries live in TypeScript so the compiled Client bundle carries
 * them without a dictionary loader; `locale/en.json` and `locale/zh.json` keep
 * the plugin's inventory metadata (`meta.title` / `meta.description`) that the
 * Plugin manager reads without activating the plugin. Keep the two in step when
 * a string changes.
 *
 * The host theme and language are the user's, so the language is resolved from
 * the page (`<html lang>`, then `navigator.language`) at mount time.
 *
 * @module dsh-selection-translate/client/i18n
 */

export interface Messages {
  /** Text on the floating button. */
  button: string
  /** Badge shown while a call runs. */
  loading: string
  /** Copy button, idle. */
  copy: string
  /** Copy button, just copied. */
  copied: string
  /** Close button (also the Esc hint). */
  close: string
  /** Retry button in the error state. */
  retry: string
  /** Cancel button shown while a call is running. */
  cancel: string
  /** Small line above the card title, naming what the card holds. */
  cardEyebrow: string
  /** Badge for an answer served from the Host cache. */
  cachedHit: string
  /** Translation language of a successful answer. */
  targetOf: (language: string) => string
  /** Refusal: the plugin row is switched off. */
  disabled: string
  /** Refusal: the selection is shorter than `minChars`. */
  tooShort: (minChars: number) => string
  /** Refusal: the selection is longer than `maxChars`. */
  tooLong: (maxChars: number) => string
  /** Refusal: no provider/model route is configured. */
  noModel: string
  /** Failure: the model call failed. */
  failed: string
  /** Failure: too many translations are running. */
  busy: string
  /** Failure: the answer was cancelled or dropped. */
  cancelled: string
  /** Fallback for an unknown failure. */
  unknown: string
  /** Tooltip naming the model route that produced the answer. */
  modelHint: (model: string) => string
  /** Title of the configuration panel. */
  settingsTitle: string
  /** Group heading: the master switch and the length bounds. */
  groupBasic: string
  /** Group heading: source, target, style and the extra instructions. */
  groupLanguage: string
  /** Group heading: the model route and the prompt preview. */
  groupAdvanced: string
  /** Label of the master switch row. */
  enabledLabel: string
  /** One line under the master switch explaining what it does when on. */
  enabledHint: string
  /** Label of the source-language select. */
  sourceLabel: string
  /** Label of the destination-language select. */
  targetLabel: string
  /** Label of the style select. */
  styleLabel: string
  /** Label of the model input. */
  modelLabel: string
  /** Placeholder of the model input. */
  modelPlaceholder: string
  /** Hint naming the route a call would use right now. */
  modelEffective: (model: string) => string
  /** Label of the custom instruction textarea. */
  customPromptLabel: string
  /** Placeholder of the custom instruction textarea. */
  customPromptPlaceholder: string
  /** Label of the minimum length input. */
  minCharsLabel: string
  /** Error shown under the minimum length input when it is outside 1..maxChars. */
  minCharsInvalid: string
  /** Label of the length bound input. */
  lengthLabel: string
  /** Unit shown after a character-count input. */
  charsUnit: string
  /** Save button, idle. */
  save: string
  /** Save button while a write runs. */
  saving: string
  /** Status line after a successful write. */
  saved: string
  /** Status line after a failed write. */
  saveFailed: string
  /** Note shown when this deployment serves no writable settings service. */
  settingsUnavailable: string
  /** Title of the collapsed prompt preview. */
  previewTitle: string
  /** Label above the rendered system message. */
  previewSystem: string
  /** Label above the rendered user message. */
  previewUser: string
  /** Button that opens the prompt preview. */
  previewRun: string
  /** Button that restores the documented defaults. */
  resetDefaults: string
  /** Source option: let the model detect the language. */
  autoDetect: string
  /** Destination option: follow the interface language. */
  autoFollow: string
  /** Style label: fluent. */
  styleFluent: string
  /** Style label: literal. */
  styleLiteral: string
  /** Style label: technical. */
  styleTechnical: string
  /** Style label: preserve the original tone. */
  stylePreserveTone: string
}

const en: Messages = {
  button: 'Translate',
  loading: 'Translating…',
  copy: 'Copy',
  copied: 'Copied',
  close: 'Close (Esc)',
  retry: 'Retry',
  cancel: 'Cancel',
  cardEyebrow: 'Translation',
  cachedHit: 'cached',
  targetOf: (language) => `→ ${language}`,
  disabled: 'Selection translate is turned off in this DSH profile.',
  tooShort: (minChars) => `Select at least ${minChars} characters.`,
  tooLong: (maxChars) => `Selection is longer than ${maxChars} characters.`,
  noModel: 'No model route is configured for translation. Set config.model or a default model.',
  failed: 'The translation call failed.',
  busy: 'Too many translations are running. Try again in a moment.',
  cancelled: 'The translation was cancelled.',
  unknown: 'Translation is unavailable.',
  modelHint: (model) => `Translated with ${model}`,
  settingsTitle: 'Translation settings',
  groupBasic: 'Basics',
  groupLanguage: 'Language & style',
  groupAdvanced: 'Advanced',
  enabledLabel: 'Translate selection',
  enabledHint: 'Select text in a message to reveal the translate button next to it.',
  sourceLabel: 'Source language',
  targetLabel: 'Target language',
  styleLabel: 'Style',
  modelLabel: 'Model',
  modelPlaceholder: 'provider/model; leave blank to follow the default model',
  modelEffective: (model) => `In effect now: ${model}`,
  customPromptLabel: 'Extra prompt',
  customPromptPlaceholder:
    'Appended to the system prompt; these instructions win over the built-in rules where they conflict.',
  minCharsLabel: 'Min length',
  minCharsInvalid: 'Must be at least 1 and no larger than the max length.',
  lengthLabel: 'Max length',
  charsUnit: 'chars',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved and now in effect',
  saveFailed: 'Could not save',
  settingsUnavailable:
    'This deployment serves no writable settings service. Edit the selection-translate row in the profile cordis.patch.yml instead.',
  previewTitle: 'Prompt preview',
  previewSystem: 'system',
  previewUser: 'user',
  previewRun: 'Preview prompt',
  resetDefaults: 'Reset to defaults',
  autoDetect: 'Detect automatically',
  autoFollow: 'Follow interface language',
  styleFluent: 'Fluent',
  styleLiteral: 'Literal',
  styleTechnical: 'Technical',
  stylePreserveTone: 'Preserve tone',
}

const zh: Messages = {
  button: '翻译',
  loading: '翻译中…',
  copy: '复制',
  copied: '已复制',
  close: '关闭 (Esc)',
  retry: '重试',
  cancel: '取消',
  cardEyebrow: '译文',
  cachedHit: '命中缓存',
  targetOf: (language) => `→ ${language}`,
  disabled: '当前 DSH 配置中已关闭划词翻译。',
  tooShort: (minChars) => `请至少选择 ${minChars} 个字符。`,
  tooLong: (maxChars) => `选区超过 ${maxChars} 个字符。`,
  noModel: '未配置可用于翻译的模型路由。请设置 config.model 或默认模型。',
  failed: '翻译调用失败。',
  busy: '同时进行的翻译过多，请稍后再试。',
  cancelled: '翻译已取消。',
  unknown: '翻译暂不可用。',
  modelHint: (model) => `译文来自 ${model}`,
  settingsTitle: '翻译设置',
  groupBasic: '基础',
  groupLanguage: '语言与风格',
  groupAdvanced: '高级',
  enabledLabel: '启用划词翻译',
  enabledHint: '在消息里选中文字后，旁边会浮出翻译按钮。',
  sourceLabel: '源语言',
  targetLabel: '目标语言',
  styleLabel: '翻译风格',
  modelLabel: '模型',
  modelPlaceholder: 'provider/model，留空则跟随默认模型',
  modelEffective: (model) => `当前生效：${model}`,
  customPromptLabel: '自定义附加 prompt',
  customPromptPlaceholder: '会追加到 system prompt，优先级高于内置规则。',
  minCharsLabel: '最短长度',
  minCharsInvalid: '需 ≥ 1，且不超过长度上限。',
  lengthLabel: '长度上限',
  charsUnit: '字符',
  save: '保存',
  saving: '保存中…',
  saved: '已保存，已生效',
  saveFailed: '保存失败',
  settingsUnavailable: '当前部署没有可写的设置服务，请手改 profile 的 cordis.patch.yml 中 selection-translate 那一行的配置。',
  previewTitle: '预览 prompt',
  previewSystem: 'system',
  previewUser: 'user',
  previewRun: '预览 prompt',
  resetDefaults: '重置为默认值',
  autoDetect: '自动识别',
  autoFollow: '跟随界面语言',
  styleFluent: '流畅',
  styleLiteral: '直译',
  styleTechnical: '技术文档',
  stylePreserveTone: '保留语气',
}

/** Resolve the interface language of the page. */
export function resolveLocale(): 'zh' | 'en' {
  const fromDocument = typeof document === 'undefined' ? '' : document.documentElement.lang
  const fromNavigator = typeof navigator === 'undefined' ? '' : navigator.language
  const tag = (fromDocument || fromNavigator || 'en').toLowerCase()
  return tag.startsWith('zh') ? 'zh' : 'en'
}

/**
 * Pick the dictionary for a resolved locale.
 * @param locale - resolved interface language.
 * @returns the message table.
 */
export function messagesFor(locale: 'zh' | 'en'): Messages {
  return locale === 'zh' ? zh : en
}
