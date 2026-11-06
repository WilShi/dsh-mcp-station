/**
 * Locale dictionaries for the MCP Station client surfaces.
 *
 * Keys are shared by both dictionaries; interpolation uses the shell's
 * `{param}` placeholder syntax. Catalog content (preset names, taglines, risk
 * reasons) arrives as {@link LocalizedText} and is resolved with
 * {@link localizedText} against the language the shell currently renders.
 */

import type { LocalizedText, PresetCategory, RiskLevel } from '../shared/types.ts'

export const zh = {
  nav: 'MCP Station',
  subtitle: 'MCP 应用商店 · 一键装好',
  close: '关闭',
  cancel: '取消',
  retry: '重试',
  refresh: '刷新',
  loading: '加载中…',
  unknownError: '未知错误',
  copy: '复制',

  tabsLabel: 'MCP Station 分区',
  tabStore: '应用商店',
  tabInstalled: '已安装',
  tabSettings: '设置',

  searchPlaceholder: '搜索 MCP 服务器…',
  searchLabel: '搜索 MCP 服务器',
  clearSearch: '清除搜索',
  categoryAll: '全部',
  categoryLabel: '按分类筛选',
  catBrowser: '浏览器',
  catSearch: '搜索',
  catDev: '开发',
  catData: '数据',
  catMemory: '记忆',
  catProductivity: '效率',
  storeSummary: '{shown} / {total} 个预设',
  storeNoResults: '没有匹配的服务器',
  storeNoResultsHint: '换个关键词或分类试试。',
  resetFilters: '清除筛选',

  transportStdio: 'stdio',
  transportHttp: 'HTTP',
  requiresLabel: '依赖',
  reqChrome: 'Chrome',
  reqNode: 'Node.js',
  reqApiKey: 'API Key',
  requiresHintChrome: '需要本机安装 Chrome',
  requiresHintNode: '需要 Node.js（npx 启动）',
  requiresHintApiKey: '需要 API Key 或其它密钥',
  riskLow: '低风险',
  riskMedium: '中风险',
  riskHigh: '高风险',
  riskTitle: '风险提示：{reasons}',
  riskReasons: '风险说明',
  docs: '文档',

  install: '安装',
  installed: '已安装',
  manage: '管理',
  installTitle: '安装 {name}',
  installSubmit: '确认安装',
  installBusy: '正在安装…',
  noInputs: '此预设不需要额外参数，确认后即可安装。',
  installSuccess: '安装成功',
  installFailed: '安装失败',
  fieldRequired: '请填写此项',
  fieldOptional: '可选',
  secretHint: '内容不会回显，也不会写入任何界面日志。',
  pathHint: '支持绝对路径；留空时使用默认值。',
  urlHint: '需要完整的 http(s) 地址。',
  invalidUrl: '请输入有效的 http(s) 地址',
  defaultValueHint: '留空则使用预设默认值。',

  connected: '已连接',
  error: '错误',
  unknown: '未检测',
  disabled: '已停用',
  toolCount: '{count} 个工具',
  latency: '{ms} ms',
  statusAria: '连接状态：{status}',
  toggleAria: '启用或停用 {name}',
  test: '测试连接',
  testing: '测试中…',
  testDisabledHint: '服务器已停用，先启用再测试连接。',
  testOk: '连接正常 · {count} 个工具 · {ms} ms',
  testFailed: '连接失败',
  uninstall: '删除',
  removeConfirm: '确认删除？',
  removeConfirmHint: '会从 profile 的 patch 中移除该服务器，操作不可撤销。',
  removing: '删除中…',
  expandTools: '展开工具（{count}）',
  expandToolsUnknown: '展开工具',
  collapseTools: '收起工具',
  noTools: '没有工具信息（服务器可能尚未连接）',
  toolDangerous: '危险',
  originExternal: '外部配置',
  externalHint: '外部配置只读，请在 profile 的 cordis.patch.yml 中管理。',
  lastChecked: '上次检测：{time}',
  neverChecked: '尚未检测',
  empty: '还没有安装 MCP 服务器',
  emptyHint: '去「应用商店」挑一个，一键装好。',
  goStore: '去应用商店',
  installedSummary: '共 {count} 个服务器',

  statusTitle: '运行状态',
  doctorTitle: '环境检查',
  doctorEmpty: '暂无检查项',
  doctorAllOk: '全部检查通过',
  doctorFailed: '{count} 项待处理',
  checkPass: '通过',
  checkFail: '失败',
  fieldPluginVersion: '插件版本',
  fieldDshVersion: 'DSH 版本',
  fieldProfile: 'Profile',
  fieldProfileDir: 'Profile 目录',
  fieldPatch: 'Patch 文件',
  fieldCatalog: '预设目录',
  fieldCatalogValue: 'v{version} · {updated}',
  fieldPresets: '预设数量',
  fieldInstalled: '已安装',
  fieldChrome: 'Chrome',
  fieldChromePath: 'Chrome 路径',
  fieldPlaywright: 'Playwright 浏览器缓存',
  chromeMissing: '未检测到 Chrome',
  chromeHint: '浏览器类预设会复用本机 Chrome，避免下载 Chromium。',
  none: '无',
  warningsTitle: '提示',
  settingsLoadFailed: '运行状态加载失败',
  doctorLoadFailed: '环境检查加载失败',
  refreshStatus: '刷新状态',

  toastInstalled: '已安装 {name}',
  toastRemoved: '已删除 {name}',
  toastEnabled: '已启用 {name}',
  toastDisabled: '已停用 {name}',
  toastTestOk: '{name} 连接正常',
  toastTestFailed: '{name} 连接失败',
  toastCopied: '已复制到剪贴板',
  toastCopyFailed: '复制失败，请手动选择文本。',
} as const

export type StationLocaleKey = keyof typeof zh

export const en: Record<StationLocaleKey, string> = {
  nav: 'MCP Station',
  subtitle: 'MCP app store · one-click install',
  close: 'Close',
  cancel: 'Cancel',
  retry: 'Retry',
  refresh: 'Refresh',
  loading: 'Loading…',
  unknownError: 'Unknown error',
  copy: 'Copy',
  tabsLabel: 'MCP Station sections',
  tabStore: 'Store',
  tabInstalled: 'Installed',
  tabSettings: 'Settings',
  searchPlaceholder: 'Search MCP servers…',
  searchLabel: 'Search MCP servers',
  clearSearch: 'Clear search',
  categoryAll: 'All',
  categoryLabel: 'Filter by category',
  catBrowser: 'Browser',
  catSearch: 'Search',
  catDev: 'Dev',
  catData: 'Data',
  catMemory: 'Memory',
  catProductivity: 'Productivity',
  storeSummary: '{shown} of {total} presets',
  storeNoResults: 'No matching servers',
  storeNoResultsHint: 'Try another keyword or category.',
  resetFilters: 'Clear filters',
  transportStdio: 'stdio',
  transportHttp: 'HTTP',
  requiresLabel: 'Requires',
  reqChrome: 'Chrome',
  reqNode: 'Node.js',
  reqApiKey: 'API key',
  requiresHintChrome: 'Needs Chrome installed on this machine',
  requiresHintNode: 'Needs Node.js (launched through npx)',
  requiresHintApiKey: 'Needs an API key or other secret',
  riskLow: 'Low risk',
  riskMedium: 'Medium risk',
  riskHigh: 'High risk',
  riskTitle: 'Risk: {reasons}',
  riskReasons: 'Risk reasons',
  docs: 'Docs',
  install: 'Install',
  installed: 'Installed',
  manage: 'Manage',
  installTitle: 'Install {name}',
  installSubmit: 'Install now',
  installBusy: 'Installing…',
  noInputs: 'This preset needs no extra settings — confirm to install.',
  installSuccess: 'Installed',
  installFailed: 'Install failed',
  fieldRequired: 'This field is required',
  fieldOptional: 'Optional',
  secretHint: 'Not echoed and never written to UI logs.',
  pathHint: 'Absolute paths work; leave empty to use the default.',
  urlHint: 'A full http(s) address is required.',
  invalidUrl: 'Enter a valid http(s) URL',
  defaultValueHint: 'Leave empty to use the preset default.',
  connected: 'Connected',
  error: 'Error',
  unknown: 'Unknown',
  disabled: 'Disabled',
  toolCount: '{count} tools',
  latency: '{ms} ms',
  statusAria: 'Connection status: {status}',
  toggleAria: 'Enable or disable {name}',
  test: 'Test connection',
  testing: 'Testing…',
  testDisabledHint: 'The server is disabled — enable it before testing.',
  testOk: 'Connected · {count} tools · {ms} ms',
  testFailed: 'Connection failed',
  uninstall: 'Remove',
  removeConfirm: 'Remove this server?',
  removeConfirmHint: 'It is removed from the profile patch; this cannot be undone.',
  removing: 'Removing…',
  expandTools: 'Show tools ({count})',
  expandToolsUnknown: 'Show tools',
  collapseTools: 'Hide tools',
  noTools: 'No tool information (the server may not be connected)',
  toolDangerous: 'Dangerous',
  originExternal: 'External',
  externalHint: 'External rows are read-only; manage them in the profile cordis.patch.yml.',
  lastChecked: 'Last checked: {time}',
  neverChecked: 'Not checked yet',
  empty: 'No MCP servers installed yet',
  emptyHint: 'Open the Store and install one in a click.',
  goStore: 'Open the Store',
  installedSummary: '{count} servers',
  statusTitle: 'Runtime status',
  doctorTitle: 'Environment check',
  doctorEmpty: 'No checks reported',
  doctorAllOk: 'All checks passed',
  doctorFailed: '{count} need attention',
  checkPass: 'Pass',
  checkFail: 'Fail',
  fieldPluginVersion: 'Plugin version',
  fieldDshVersion: 'DSH version',
  fieldProfile: 'Profile',
  fieldProfileDir: 'Profile directory',
  fieldPatch: 'Patch file',
  fieldCatalog: 'Preset catalog',
  fieldCatalogValue: 'v{version} · {updated}',
  fieldPresets: 'Presets',
  fieldInstalled: 'Installed',
  fieldChrome: 'Chrome',
  fieldChromePath: 'Chrome path',
  fieldPlaywright: 'Playwright browser cache',
  chromeMissing: 'Chrome not detected',
  chromeHint: 'Browser presets reuse your local Chrome instead of downloading Chromium.',
  none: 'None',
  warningsTitle: 'Notices',
  settingsLoadFailed: 'Failed to load runtime status',
  doctorLoadFailed: 'Failed to load environment checks',
  refreshStatus: 'Refresh status',
  toastInstalled: 'Installed {name}',
  toastRemoved: 'Removed {name}',
  toastEnabled: 'Enabled {name}',
  toastDisabled: 'Disabled {name}',
  toastTestOk: '{name} is connected',
  toastTestFailed: '{name} failed to connect',
  toastCopied: 'Copied to clipboard',
  toastCopyFailed: 'Copy failed — select the text manually.',
}

/** Languages the shipped dictionaries cover. */
export type UiLocale = 'zh' | 'en'

/** Label keys for preset categories in catalog order. */
export const CATEGORY_ORDER: readonly PresetCategory[] = ['browser', 'search', 'dev', 'data', 'memory', 'productivity']

/** Locale key of each category label. */
export const CATEGORY_LABEL_KEYS: Record<PresetCategory, StationLocaleKey> = {
  browser: 'catBrowser',
  search: 'catSearch',
  dev: 'catDev',
  data: 'catData',
  memory: 'catMemory',
  productivity: 'catProductivity',
}

/** Locale key of each risk level label. */
export const RISK_LABEL_KEYS: Record<RiskLevel, StationLocaleKey> = {
  low: 'riskLow',
  medium: 'riskMedium',
  high: 'riskHigh',
}

let remembered: UiLocale = 'en'

/** Remember the active locale for non-DOM renders. */
export function setUiLocale(active: string): void {
  remembered = active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * Read the locale the shell is currently rendering.
 * @returns the active UI language.
 */
export function uiLocale(): UiLocale {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement.lang
    if (lang !== '') return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  return remembered
}

/**
 * Resolve a localized catalog value against the active language.
 * @param text - localized value from the catalog.
 * @param locale - language to render, defaults to the shell locale.
 * @returns the resolved text with a cross-language fallback.
 */
export function localizedText(text: LocalizedText | undefined, locale: UiLocale = uiLocale()): string {
  if (text === undefined) return ''
  const value = text[locale]
  if (value !== undefined && value !== '') return value
  return text.en !== '' ? text.en : text.zh
}

/**
 * Format an ISO timestamp as local wall-clock time.
 * @param iso - ISO timestamp, possibly absent.
 * @param locale - language used for the time format.
 * @returns the formatted time, or an empty string.
 */
export function formatClock(iso: string | undefined, locale: UiLocale = uiLocale()): string {
  if (iso === undefined || iso === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
