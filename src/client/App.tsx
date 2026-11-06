/** MCP Station panel: store, installed servers and settings. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { CatalogFile, InstalledServer } from '../shared/types.ts'
import { errorMessage, fetchCatalog } from './api.ts'
import { InstalledTab } from './InstalledTab.tsx'
import { SettingsTab } from './SettingsTab.tsx'
import { StoreTab } from './StoreTab.tsx'
import { localizedText, type StationLocaleKey } from './locales.ts'
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
    setServers((current) => {
      const index = current.findIndex(item => item.serverName === server.serverName)
      if (index === -1) return current.concat(server)
      const next = current.slice()
      next[index] = server
      return next
    })
  }, [])

  const dropServer = useCallback((serverName: string): void => {
    setServers(current => current.filter(item => item.serverName !== serverName))
  }, [])

  const handleInstalled = useCallback(
    (server: InstalledServer): void => {
      upsertServer(server)
      const name = localizedText(server.displayName) === '' ? server.serverName : localizedText(server.displayName)
      pushToast('success', t('toastInstalled', { name }))
    },
    [pushToast, t, upsertServer],
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
            catalog={catalog}
            servers={servers}
            t={t}
            onInstalled={handleInstalled}
            onOpenInstalled={() => {
              setTab('installed')
            }}
          />
        ) : null}
        {ready && tab === 'installed' ? (
          <InstalledTab
            servers={servers}
            t={t}
            onPatch={upsertServer}
            onRemove={dropServer}
            onToast={pushToast}
            onOpenStore={() => {
              setTab('store')
            }}
          />
        ) : null}
        {ready && tab === 'settings' ? <SettingsTab t={t} onToast={pushToast} refreshToken={settingsToken} /> : null}
      </div>

      <ToastStack items={toasts} t={t} onDismiss={dismissToast} />
    </div>
  )
}
