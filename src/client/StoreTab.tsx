/** Store tab: search, category filter, preset cards and the install dialog. */

import { useMemo, useState, type JSX } from 'react'
import type { CatalogFile, CatalogPreset, InstalledServer, PresetCategory } from '../shared/types.ts'
import { CATEGORY_LABEL_KEYS, CATEGORY_ORDER, localizedText, uiLocale } from './locales.ts'
import { InstallDialog } from './InstallDialog.tsx'
import { Badge, EmptyState, RiskBadge, type TFunc } from './ui.tsx'

const ALL = 'all'

type CategoryFilter = typeof ALL | PresetCategory

/** Store tab properties. */
export interface StoreTabProps {
  catalog: CatalogFile
  servers: readonly InstalledServer[]
  t: TFunc
  onInstalled: (server: InstalledServer) => void
  onOpenInstalled: () => void
}

interface RequirementChip {
  label: string
  hint: string
}

function requirementsOf(preset: CatalogPreset, t: TFunc): RequirementChip[] {
  const chips: RequirementChip[] = []
  if (preset.requires?.chrome === true) chips.push({ label: t('reqChrome'), hint: t('requiresHintChrome') })
  if (preset.requires?.node === true) chips.push({ label: t('reqNode'), hint: t('requiresHintNode') })
  if (preset.requires?.apiKey === true) chips.push({ label: t('reqApiKey'), hint: t('requiresHintApiKey') })
  return chips
}

function matchesQuery(preset: CatalogPreset, needle: string, locale: 'zh' | 'en'): boolean {
  if (needle === '') return true
  const values = [
    localizedText(preset.displayName, locale),
    localizedText(preset.tagline, locale),
    localizedText(preset.description, locale),
    preset.id,
    preset.serverName,
    ...(preset.tags ?? []),
  ]
  return values.some(value => value.toLowerCase().includes(needle))
}

/** Preset catalog browser. */
export function StoreTab(props: StoreTabProps): JSX.Element {
  const { t, catalog, servers } = props
  const locale = uiLocale()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>(ALL)
  const [target, setTarget] = useState<CatalogPreset | null>(null)

  const categories = useMemo(() => {
    const present = new Set(catalog.presets.map(preset => preset.category))
    return CATEGORY_ORDER.filter(item => present.has(item))
  }, [catalog])

  const installedPresets = useMemo(() => {
    const map = new Map<string, InstalledServer>()
    for (const server of servers) {
      if (server.presetId !== undefined && !map.has(server.presetId)) map.set(server.presetId, server)
    }
    return map
  }, [servers])

  const installedNames = useMemo(
    () => new Set(servers.map(server => server.serverName.toLowerCase())),
    [servers],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalog.presets.filter(preset => {
      if (category !== ALL && preset.category !== category) return false
      return matchesQuery(preset, needle, locale)
    })
  }, [catalog, category, locale, query])

  const filtersActive = query.trim() !== '' || category !== ALL

  return (
    <>
      <div className="ms_storeBar">
        <div className="ms_searchWrap">
          <input
            className="ms_search"
            type="search"
            value={query}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          {query === '' ? null : (
            <button
              className="ms_searchClear"
              type="button"
              aria-label={t('clearSearch')}
              onClick={() => {
                setQuery('')
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="ms_chips" role="group" aria-label={t('categoryLabel')}>
          <button
            className="ms_chip"
            type="button"
            data-on={category === ALL}
            aria-pressed={category === ALL}
            onClick={() => {
              setCategory(ALL)
            }}
          >
            {t('categoryAll')}
          </button>
          {categories.map(item => (
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
        <div className="ms_row">
          <span className="ms_meta" role="status">
            {t('storeSummary', { shown: visible.length, total: catalog.presets.length })}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={t('storeNoResults')}
          hint={t('storeNoResultsHint')}
          action={
            filtersActive ? (
              <button
                className="ms_btn"
                type="button"
                onClick={() => {
                  setQuery('')
                  setCategory(ALL)
                }}
              >
                {t('resetFilters')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="ms_grid">
          {visible.map((preset) => {
            const name = localizedText(preset.displayName, locale) || preset.serverName
            const tagline = localizedText(preset.tagline, locale) || localizedText(preset.description, locale)
            const requirements = requirementsOf(preset, t)
            const installed =
              installedPresets.has(preset.id) || installedNames.has(preset.serverName.toLowerCase())
            return (
              <article className="ms_card ms_storeCard" key={preset.id} aria-label={name}>
                <div className="ms_cardHead">
                  <span className="ms_cardName" title={preset.serverName}>
                    {name}
                  </span>
                  <RiskBadge level={preset.risk.level} reasons={preset.risk.reasons} t={t} />
                </div>
                <p className="ms_cardTag">{tagline}</p>
                <div className="ms_cardBadges">
                  <Badge tone="plain">{preset.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</Badge>
                  <Badge tone="info">{t(CATEGORY_LABEL_KEYS[preset.category])}</Badge>
                  {requirements.length === 0 ? null : (
                    <span className="ms_meta">{t('requiresLabel')}</span>
                  )}
                  {requirements.map(item => (
                    <Badge key={item.label} tone="warn" title={item.hint}>
                      {item.label}
                    </Badge>
                  ))}
                </div>
                <div className="ms_cardFoot">
                  <span className="ms_mono">{preset.serverName}</span>
                  {preset.docs === undefined ? null : (
                    <a className="ms_link" href={preset.docs} target="_blank" rel="noreferrer">
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
                    <button
                      className="ms_btn ms_btnPrimary"
                      type="button"
                      onClick={() => {
                        setTarget(preset)
                      }}
                    >
                      {t('install')}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {target === null ? null : (
        <InstallDialog
          preset={target}
          t={t}
          onClose={() => {
            setTarget(null)
          }}
          onInstalled={props.onInstalled}
        />
      )}
    </>
  )
}
