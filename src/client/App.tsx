/** MCP Station panel: store, installed servers and settings. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type {
  CatalogFile,
  DisplayLanguage,
  ImportPayload,
  InstalledServer,
  ProbeResult,
} from '../shared/types.ts'
import { applyProbe, errorMessage, fetchCatalog, fetchSettings, saveSettings, testServer } from './api.ts'
import { CustomServerDialog, type CustomSavedOptions } from './CustomServerDialog.tsx'
import { ImportDialog } from './ImportDialog.tsx'
import { InstalledTab } from './InstalledTab.tsx'
import { SettingsTab } from './SettingsTab.tsx'
import { StoreTab } from './StoreTab.tsx'
import { localizedText, setDisplayLanguage, type DisplayLanguageChoice, type StationLocaleKey } from './locales.ts'
import { readAutoTest, writeAutoTest } from './prefs.ts'
import { ErrorState, LoadingState, Spinner, ToastStack, type ToastItem, type TFunc } from './ui.tsx'

/** Panel properties; `embedded` fills a settings section instead of a drawer. */
export interface StationAppProps {
  t: TFunc
  embedded?: boolean
}

type Tab = 'store' | 'installed' | 'settings'

const TABS: readonly { id: Tab; key: StationLocaleKey }[] = [
  { id: 'store', key: 'tabStore' },
  { id: 'installed', key: 'tabInstalled' },
  { id: 'settings', key: 'tabSettings' },
]

interface CustomDialogState {
  editing?: InstalledServer
}

function serverName(server: InstalledServer): string {
  const label = localizedText(server.displayName)
  return label === '' ? server.serverName : label
}

function mergeServers(
  current: readonly InstalledServer[],
  incoming: readonly InstalledServer[],
): readonly InstalledServer[] {
  const map = new Map(current.map(server => [server.serverName, server]))
  for (const server of incoming) map.set(server.serverName, { ...map.get(server.serverName), ...server })
  return [...map.values()]
}

function withoutName(record: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...record }
  Reflect.deleteProperty(next, key)
  return next
}

function RefreshIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.3 7A5.5 5.5 0 1 0 13 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M13.4 3.2v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Root component rendered in the sidebar drawer and the settings section. */
export function StationApp(props: StationAppProps): JSX.Element {
  const t: TFunc = props.t
  const [tab, setTab] = useState<Tab>('store')
  const [catalog, setCatalog] = useState<CatalogFile | null>(null)
  const [servers, setServers] = useState<readonly InstalledServer[]>([])
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [settingsToken, setSettingsToken] = useState(0)
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const [displayLanguage, setDisplayLanguageState] = useState<DisplayLanguageChoice>('auto')
  const [autoTest, setAutoTestState] = useState<boolean>(() => readAutoTest())
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [customDialog, setCustomDialog] = useState<CustomDialogState | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const toastSeq = useRef(0)
  const timers = useRef<Set<number>>(new Set())
  const catalogRef = useRef<CatalogFile | null>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)

  const pushToast = useCallback((kind: ToastItem['kind'], message: string): void => {
    const id = toastSeq.current + 1
    toastSeq.current = id
    setToasts(current => current.concat({ id, kind, message }))
    const timer = window.setTimeout(
      () => {
        timers.current.delete(timer)
        setToasts(current => current.filter(item => item.id !== id))
      },
      kind === 'error' ? 6000 : 3600,
    )
    timers.current.add(timer)
  }, [])

  const dismissToast = useCallback((id: number): void => {
    setToasts(current => current.filter(item => item.id !== id))
  }, [])

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      timers.current.clear()
    },
    [],
  )

  // Display language: fetched once from the host, then applied globally so the
  // preset text in every tab resolves against the chosen language.
  useEffect(() => {
    let active = true
    void fetchSettings()
      .then((payload) => {
        if (!active) return
        const next = payload.settings.displayLanguage
        setDisplayLanguage(next)
        setDisplayLanguageState(next)
      })
      .catch(() => {
        // Older hosts have no /settings route; keep following the DSH locale.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setRefreshing(true)
    setLoadError('')
    void fetchCatalog()
      .then((payload) => {
        if (!active) return
        catalogRef.current = payload.catalog
        setCatalog(payload.catalog)
        setServers(payload.servers)
      })
      .catch((cause: unknown) => {
        if (!active) return
        const message = errorMessage(cause, t('unknownError'))
        if (catalogRef.current === null) setLoadError(message)
        else pushToast('error', message)
      })
      .finally(() => {
        if (active) setRefreshing(false)
      })
    return () => {
      active = false
    }
  }, [pushToast, reloadToken, t])

  const upsertServer = useCallback((server: InstalledServer): void => {
    setServers(current => {
      const index = current.findIndex(item => item.serverName === server.serverName)
      if (index === -1) return current.concat(server)
      const next = current.slice()
      next[index] = server
      return next
    })
  }, [])

  const dropServer = useCallback((name: string): void => {
    setServers(current => current.filter(item => item.serverName !== name))
  }, [])

  /**
   * Probe one server and merge the outcome into the list. Returns the probe
   * result so dialogs can render it inline.
   * @param server - row to test (name is the identity).
   */
  const probeServer = useCallback(
    async (server: InstalledServer): Promise<ProbeResult | null> => {
      setProbing(current => ({ ...current, [server.serverName]: true }))
      try {
        const payload = await testServer(server.serverName)
        setServers(current =>
          current.map(item => (item.serverName === server.serverName ? applyProbe(item, payload.result) : item)),
        )
        if (!payload.result.ok) {
          pushToast('error', t('toastTestFailed', { name: serverName(server) }))
        }
        return payload.result
      } catch (cause: unknown) {
        const message = errorMessage(cause, t('unknownError'))
        setServers(current =>
          current.map(item =>
            item.serverName === server.serverName ? { ...item, status: 'error', error: message } : item,
          ),
        )
        pushToast('error', t('toastTestFailed', { name: serverName(server) }))
        return null
      } finally {
        setProbing(current => withoutName(current, server.serverName))
      }
    },
    [pushToast, t],
  )

  const handleInstalled = useCallback(
    (server: InstalledServer): void => {
      upsertServer(server)
      pushToast('success', t('toastInstalled', { name: serverName(server) }))
      if (autoTest && server.enabled && server.status === 'unknown') void probeServer(server)
    },
    [autoTest, probeServer, pushToast, t, upsertServer],
  )

  const handleCustomSaved = useCallback(
    (server: InstalledServer, options?: CustomSavedOptions): void => {
      upsertServer(server)
      pushToast('success', t('toastCustomSaved', { name: serverName(server) }))
      if (options?.skipAutoTest === true) return
      if (autoTest && server.enabled && server.status === 'unknown') void probeServer(server)
    },
    [autoTest, probeServer, pushToast, t, upsertServer],
  )

  const handleImported = useCallback(
    (payload: ImportPayload): void => {
      const imported = Array.isArray(payload.imported) ? payload.imported : []
      const skipped = Array.isArray(payload.skipped) ? payload.skipped : []
      if (imported.length > 0) setServers(current => mergeServers(current, imported))
      if (imported.length === 0) pushToast('info', t('importNothing'))
      else if (skipped.length > 0) {
        pushToast('success', t('toastImportedSkipped', { count: imported.length, skipped: skipped.length }))
      } else {
        pushToast('success', t('toastImported', { count: imported.length }))
      }
      if (!autoTest) return
      void (async () => {
        for (const server of imported) {
          if (server.enabled && server.status === 'unknown') await probeServer(server)
        }
      })()
    },
    [autoTest, probeServer, pushToast, t],
  )

  const changeDisplayLanguage = useCallback(
    (next: DisplayLanguageChoice): void => {
      setDisplayLanguage(next)
      setDisplayLanguageState(next)
      const language: DisplayLanguage = next
      void saveSettings({ displayLanguage: language }).catch(() => {
        pushToast('error', t('languageUpdateFailed'))
      })
    },
    [pushToast, t],
  )

  const changeAutoTest = useCallback((value: boolean): void => {
    setAutoTestState(value)
    writeAutoTest(value)
  }, [])

  const sourceLabelOf = useCallback(
    (server: InstalledServer): string | undefined => {
      const presets = catalogRef.current === null ? [] : catalogRef.current.presets
      const preset = presets.find(
        item =>
          (item.id === server.presetId || item.serverName === server.serverName) &&
          (server.sourceId === undefined || item.sourceId === server.sourceId),
      )
      const sourceId = server.sourceId ?? preset?.sourceId
      if (sourceId === undefined) return undefined
      if (sourceId === 'builtin') return t('sourceCurated')
      if (sourceId === 'mcp-registry') return t('sourceRegistry')
      const sourceName = server.sourceName ?? (preset?.sourceId === sourceId ? preset.sourceName : undefined)
      return sourceName === undefined || sourceName === '' ? sourceId : sourceName
    },
    [t],
  )

  const refresh = (): void => {
    if (tab === 'settings') setSettingsToken(value => value + 1)
    else setReloadToken(value => value + 1)
  }

  const selectTab = (next: Tab): void => {
    setTab(next)
    const node = tabBarRef.current?.querySelector<HTMLElement>('[data-tab="' + next + '"]')
    node?.focus()
  }

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex(item => item.id === tab)
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = TABS[(index + delta + TABS.length) % TABS.length]
      if (next !== undefined) selectTab(next.id)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? TABS[0] : TABS[TABS.length - 1]
      if (next !== undefined) selectTab(next.id)
    }
  }

  const openAddCustom = (): void => {
    setCustomDialog({})
  }

  const ready = catalog !== null
  const fatal = loadError !== ''

  return (
    <div className={props.embedded === true ? 'ms_app ms_appEmbedded ms_root' : 'ms_app ms_root'}>
      <div className="ms_toolbar">
        <div className="ms_toolbarText">
          <span className="ms_headSub">{t('subtitle')}</span>
          <span className="ms_headMeta">{t('installedSummary', { count: servers.length })}</span>
        </div>
        <button
          className="ms_btn ms_btnGhost"
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          {refreshing ? <Spinner /> : <RefreshIcon />}
          <span>{t('refresh')}</span>
        </button>
      </div>

      <div
        className="ms_tabs"
        role="tablist"
        aria-label={t('tabsLabel')}
        ref={tabBarRef}
        onKeyDown={onTabKeyDown}
      >
        {TABS.map(item => (
          <button
            className="ms_tab"
            key={item.id}
            type="button"
            role="tab"
            id={'ms_tab_' + item.id}
            aria-selected={tab === item.id}
            aria-controls="ms_panel"
            tabIndex={tab === item.id ? 0 : -1}
            data-tab={item.id}
            data-active={tab === item.id}
            onClick={() => {
              setTab(item.id)
            }}
          >
            {t(item.key)}
          </button>
        ))}
      </div>

      <div className="ms_body" id="ms_panel" role="tabpanel" aria-labelledby={'ms_tab_' + tab} tabIndex={-1}>
        {fatal ? (
          <ErrorState
            message={loadError}
            retryLabel={t('retry')}
            onRetry={() => {
              setReloadToken(value => value + 1)
            }}
          />
        ) : null}
        {!fatal && !ready ? <LoadingState label={t('loading')} /> : null}
        {ready && catalog !== null && tab === 'store' ? (
          <StoreTab
            servers={servers}
            t={t}
            autoTest={autoTest}
            displayLanguage={displayLanguage}
            onDisplayLanguageChange={changeDisplayLanguage}
            onInstalled={handleInstalled}
            onOpenInstalled={() => {
              setTab('installed')
            }}
            onAddCustom={openAddCustom}
            onImportJson={() => {
              setImportOpen(true)
            }}
          />
        ) : null}
        {ready && tab === 'installed' ? (
          <InstalledTab
            servers={servers}
            t={t}
            probing={probing}
            onPatch={upsertServer}
            onRemove={dropServer}
            onToast={pushToast}
            onOpenStore={() => {
              setTab('store')
            }}
            onAddCustom={openAddCustom}
            onImportJson={() => {
              setImportOpen(true)
            }}
            onEditCustom={(server) => {
              setCustomDialog({ editing: server })
            }}
            sourceLabelOf={sourceLabelOf}
          />
        ) : null}
        {ready && tab === 'settings' ? (
          <SettingsTab
            t={t}
            onToast={pushToast}
            refreshToken={settingsToken}
            displayLanguage={displayLanguage}
            onDisplayLanguageChange={changeDisplayLanguage}
            autoTest={autoTest}
            onAutoTestChange={changeAutoTest}
            onCatalogChanged={() => {
              setReloadToken(value => value + 1)
            }}
          />
        ) : null}
      </div>

      {customDialog === null ? null : (
        <CustomServerDialog
          t={t}
          {...(customDialog.editing === undefined ? {} : { editing: customDialog.editing })}
          takenNames={servers.map(server => server.serverName)}
          onClose={() => {
            setCustomDialog(null)
          }}
          onSaved={handleCustomSaved}
          probe={probeServer}
        />
      )}
      {importOpen ? (
        <ImportDialog
          t={t}
          onClose={() => {
            setImportOpen(false)
          }}
          onImported={handleImported}
        />
      ) : null}

      <ToastStack items={toasts} t={t} onDismiss={dismissToast} />
    </div>
  )
}
