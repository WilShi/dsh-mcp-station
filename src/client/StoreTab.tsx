/** Store tab: search and browse every configured market source. */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { InstalledServer, MarketItem, MarketSource } from '../shared/types.ts'
import { errorMessage, fetchMarket, isBuiltinSource } from './api.ts'
import { CATEGORY_LABEL_KEYS, localizedText, uiLocale, type DisplayLanguageChoice } from './locales.ts'
import { InstallDialog } from './InstallDialog.tsx'
import { Badge, EmptyState, ErrorState, LoadingState, RiskBadge, Spinner, type TFunc } from './ui.tsx'

const SEARCH_DEBOUNCE_MS = 320
const PAGE_SIZE = 20

/** Store tab properties. */
export interface StoreTabProps {
  servers: readonly InstalledServer[]
  t: TFunc
  /** Probe the server right after install. */
  autoTest: boolean
  /** Persisted display language, switchable from the toolbar. */
  displayLanguage: DisplayLanguageChoice
  onDisplayLanguageChange: (value: DisplayLanguageChoice) => void
  onInstalled: (server: InstalledServer) => void
  onOpenInstalled: () => void
  onAddCustom: () => void
  onImportJson: () => void
}

interface Chip {
  id: string
  label: string
}

function sourceLabel(sourceId: string, sourceName: string | undefined, t: TFunc): string {
  if (sourceId === 'builtin') return t('sourceCurated')
  if (sourceId === 'mcp-registry') return t('sourceRegistry')
  return sourceName === undefined || sourceName === '' ? sourceId : sourceName
}

/** Cross-source MCP market. */
export function StoreTab(props: StoreTabProps): JSX.Element {
  const { t, servers } = props
  const locale = uiLocale()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [items, setItems] = useState<MarketItem[]>([])
  const [sources, setSources] = useState<MarketSource[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [retryToken, setRetryToken] = useState(0)
  const [target, setTarget] = useState<MarketItem | null>(null)
  const requestSeq = useRef(0)

  // Debounce the search box; the host does not debounce.
  useEffect(() => {
    const trimmed = search.trim()
    const timer = window.setTimeout(() => {
      setQuery(trimmed)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [search])

  const loadFirstPage = useCallback(
    (searchText: string, sourceId: string): void => {
      requestSeq.current += 1
      const sequence = requestSeq.current
      setPhase('loading')
      setError('')
      setMoreError('')
      void fetchMarket({
        search: searchText,
        ...(sourceId === 'all' ? {} : { source: sourceId }),
        limit: PAGE_SIZE,
      })
        .then((payload) => {
          if (sequence !== requestSeq.current) return
          setItems(Array.isArray(payload.items) ? payload.items : [])
          setSources(Array.isArray(payload.sources) ? payload.sources : [])
          setWarnings(Array.isArray(payload.warnings) ? payload.warnings : [])
          setNextCursor(payload.nextCursor)
          setPhase('ready')
        })
        .catch((cause: unknown) => {
          if (sequence !== requestSeq.current) return
          setItems([])
          setSources([])
          setWarnings([])
          setNextCursor(undefined)
          setError(errorMessage(cause, t('unknownError')))
          setPhase('error')
        })
    },
    [t],
  )

  useEffect(() => {
    loadFirstPage(query, source)
    setCategory('all')
  }, [loadFirstPage, query, retryToken, source])

  const loadMore = (): void => {
    if (nextCursor === undefined || loadingMore) return
    const sequence = requestSeq.current
    setLoadingMore(true)
    setMoreError('')
    void fetchMarket({
      search: query,
      ...(source === 'all' ? {} : { source }),
      cursor: nextCursor,
      limit: PAGE_SIZE,
    })
      .then((payload) => {
        if (sequence !== requestSeq.current) return
        setItems(current => current.concat(Array.isArray(payload.items) ? payload.items : []))
        setSources(Array.isArray(payload.sources) ? payload.sources : [])
        if (Array.isArray(payload.warnings)) setWarnings(payload.warnings)
        setNextCursor(payload.nextCursor)
      })
      .catch((cause: unknown) => {
        if (sequence !== requestSeq.current) return
        setMoreError(errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setLoadingMore(false)
      })
  }

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = [{ id: 'all', label: t('storeSourceAll') }]
    const seen = new Set<string>(['all'])
    const append = (id: string, name: string | undefined): void => {
      if (id === '' || seen.has(id)) return
      seen.add(id)
      list.push({ id, label: sourceLabel(id, name, t) })
    }
    append('builtin', undefined)
    append('mcp-registry', undefined)
    for (const entry of sources) if (!isBuiltinSource(entry)) append(entry.id, entry.name)
    return list
  }, [sources, t])

  const categories = useMemo(() => {
    const present = new Set(items.map(item => item.category))
    return present
  }, [items])

  const categoryFiltered = useMemo(
    () => (source === 'builtin' && query === '' && category !== 'all' ? items.filter(item => item.category === category) : items),
    [category, items, query, source],
  )

  const visible = categoryFiltered

  const installedNames = useMemo(
    () => new Set(servers.map(server => server.serverName.toLowerCase())),
    [servers],
  )

  const isInstalled = (item: MarketItem): boolean =>
    installedNames.has(item.serverName.toLowerCase()) ||
    servers.some(server => server.presetId === item.id && (server.sourceId === undefined || server.sourceId === item.sourceId))

  const installSourceId = (item: MarketItem): string | undefined =>
    item.sourceId === '' ? undefined : item.sourceId

  const filtersActive = query !== '' || source !== 'all' || category !== 'all'

  return (
    <>
      <div className="ms_storeBar">
        <div className="ms_searchWrap">
          <input
            className="ms_search"
            type="search"
            value={search}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
          {search === '' ? null : (
            <button
              className="ms_searchClear"
              type="button"
              aria-label={t('clearSearch')}
              onClick={() => {
                setSearch('')
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="ms_chips" role="group" aria-label={t('storeSourceFilterAria')}>
          {chips.map(chip => (
            <button
              className="ms_chip"
              type="button"
              key={chip.id}
              data-on={source === chip.id}
              aria-pressed={source === chip.id}
              onClick={() => {
                setSource(chip.id)
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {source === 'builtin' && query === '' && categories.size > 1 ? (
          <div className="ms_chips" role="group" aria-label={t('categoryLabel')}>
            <button
              className="ms_chip"
              type="button"
              data-on={category === 'all'}
              aria-pressed={category === 'all'}
              onClick={() => {
                setCategory('all')
              }}
            >
              {t('categoryAll')}
            </button>
            {[...categories].map(item => (
              <button
                className="ms_chip"
                type="button"
                key={item}
                data-on={category === item}
                aria-pressed={category === item}
                onClick={() => {
                  setCategory(item)
                }}
              >
                {t(CATEGORY_LABEL_KEYS[item])}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ms_row">
          <span className="ms_meta" role="status">
            {phase === 'ready' ? t('marketLoadedCount', { count: visible.length }) : null}
          </span>
          <span className="ms_spacer" />
          <select
            className="ms_select ms_selectCompact"
            aria-label={t('languageLabel')}
            title={t('languageLabel')}
            value={props.displayLanguage}
            onChange={(event) => {
              const next = event.target.value
              props.onDisplayLanguageChange(next === 'zh' ? 'zh' : next === 'en' ? 'en' : 'auto')
            }}
          >
            <option value="auto">{t('languageAuto')}</option>
            <option value="zh">{t('languageZh')}</option>
            <option value="en">{t('languageEn')}</option>
          </select>
          <button className="ms_btn" type="button" onClick={props.onAddCustom}>
            {t('addCustom')}
          </button>
          <button className="ms_btn ms_btnGhost" type="button" onClick={props.onImportJson}>
            {t('importJson')}
          </button>
        </div>
      </div>

      {warnings.length === 0 ? null : (
        <div className="ms_warnBox" role="status">
          <span className="ms_warnBoxTitle">{t('warningsTitle')}</span>
          <ul className="ms_warnList">
            {warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {phase === 'loading' ? <LoadingState label={t('loading')} /> : null}
      {phase === 'error' ? (
        <ErrorState
          message={error === '' ? t('marketLoadFailed') : error}
          retryLabel={t('retry')}
          onRetry={() => {
            setRetryToken(value => value + 1)
          }}
        />
      ) : null}
      {phase === 'ready' && visible.length === 0 ? (
        <EmptyState
          title={t('marketEmpty')}
          hint={t('marketEmptyHint')}
          action={
            filtersActive ? (
              <button
                className="ms_btn"
                type="button"
                onClick={() => {
                  setSearch('')
                  setSource('all')
                  setCategory('all')
                }}
              >
                {t('resetFilters')}
              </button>
            ) : undefined
          }
        />
      ) : null}
      {phase === 'ready' && visible.length > 0 ? (
        <div className="ms_grid">
          {visible.map((item) => {
            const name = localizedText(item.displayName, locale) || item.serverName
            const tagline = localizedText(item.tagline, locale) || localizedText(item.description, locale)
            const requirements: { label: string; hint: string }[] = []
            if (item.requires?.chrome === true) requirements.push({ label: t('reqChrome'), hint: t('requiresHintChrome') })
            if (item.requires?.node === true) requirements.push({ label: t('reqNode'), hint: t('requiresHintNode') })
            if (item.requires?.apiKey === true) requirements.push({ label: t('reqApiKey'), hint: t('requiresHintApiKey') })
            const installed = isInstalled(item)
            return (
              <article className="ms_card ms_storeCard" key={item.uid} aria-label={name}>
                <div className="ms_cardHead">
                  <span className="ms_cardName" title={item.serverName}>
                    {name}
                  </span>
                  {item.risk === undefined ? null : (
                    <RiskBadge level={item.risk.level} reasons={item.risk.reasons} t={t} />
                  )}
                </div>
                <p className="ms_cardTag">{tagline}</p>
                <div className="ms_cardBadges">
                  <Badge tone="plain">{item.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</Badge>
                  {item.category === undefined ? null : (
                    <Badge tone="info">{t(CATEGORY_LABEL_KEYS[item.category])}</Badge>
                  )}
                  <Badge tone="plain" title={t('storeSourceLabel')}>
                    {sourceLabel(item.sourceId, item.sourceName, t)}
                  </Badge>
                  {requirements.length === 0 ? null : <span className="ms_meta">{t('requiresLabel')}</span>}
                  {requirements.map(chip => (
                    <Badge key={chip.label} tone="warn" title={chip.hint}>
                      {chip.label}
                    </Badge>
                  ))}
                </div>
                <div className="ms_cardFoot">
                  <span className="ms_mono">{item.serverName}</span>
                  {item.docs === undefined ? null : (
                    <a className="ms_link" href={item.docs} target="_blank" rel="noreferrer">
                      {t('docs')}
                    </a>
                  )}
                  <span className="ms_spacer" />
                  {installed ? (
                    <>
                      <Badge tone="ok">{t('installed')}</Badge>
                      <button className="ms_btn" type="button" onClick={props.onOpenInstalled}>
                        {t('manage')}
                      </button>
                    </>
                  ) : (
                    <button className="ms_btn ms_btnPrimary" type="button" onClick={() => { setTarget(item) }}>
                      {t('install')}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {phase === 'ready' && (nextCursor !== undefined || moreError !== '') ? (
        <div className="ms_marketMore">
          {moreError === '' ? null : (
            <span className="ms_err" role="alert">
              {t('marketLoadMoreFailed')}: {moreError}
            </span>
          )}
          <button
            className="ms_btn"
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? <Spinner /> : null}
            {loadingMore ? t('marketLoadingMore') : t('marketLoadMore')}
          </button>
        </div>
      ) : null}

      {target === null ? null : (
        <InstallDialog
          preset={target}
          t={t}
          autoTest={props.autoTest}
          {...(installSourceId(target) === undefined ? {} : { sourceId: installSourceId(target) as string })}
          onClose={() => {
            setTarget(null)
          }}
          onInstalled={props.onInstalled}
        />
      )}
    </>
  )
}
