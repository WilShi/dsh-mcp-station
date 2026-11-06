/**
 * Small localStorage-backed client preferences. Everything is best-effort: a
 * blocked storage (privacy mode, embedded webview) falls back to defaults.
 */

const AUTO_TEST_KEY = 'dsh-mcp-station:auto-test'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Whether installs and imports should probe the new server automatically. */
export function readAutoTest(): boolean {
  const store = storage()
  if (store === null) return true
  try {
    const raw = store.getItem(AUTO_TEST_KEY)
    return raw === null ? true : raw !== '0'
  } catch {
    return true
  }
}

/**
 * Persist the auto-test preference.
 * @param value - new preference value.
 */
export function writeAutoTest(value: boolean): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(AUTO_TEST_KEY, value ? '1' : '0')
  } catch {
    // Storage full or blocked: the in-memory preference still applies.
  }
}
