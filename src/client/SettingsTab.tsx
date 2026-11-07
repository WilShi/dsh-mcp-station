/** Settings tab: display language, runtime status, sources, automation, doctor. */

import { useEffect, useState, type JSX } from 'react'
import type { DoctorCheck, MarketSource, StationStatus } from '../shared/types.ts'
import {
  deleteSource,
  errorMessage,
  fetchDoctor,
  fetchSources,
  fetchStatus,
  isBuiltinSource,
  refreshSources,
  saveSource,
} from './api.ts'
import { formatClock, localizedText, uiLocale, type DisplayLanguageChoice } from './locales.ts'
import { SourceDialog } from './SourceDialog.tsx'
import { Badge, EmptyState, ErrorState, LoadingState, Spinner, Switch, type TFunc } from './ui.tsx'

/** Settings tab properties. */
export interface SettingsTabProps {
  t: TFunc
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void
  /** Bumped by the panel toolbar to refresh from outside this tab. */
  refreshToken: number
  /** Persisted display language choice. */
  displayLanguage: DisplayLanguageChoice
  onDisplayLanguageChange: (value: DisplayLanguageChoice) => void
  /** Probe servers automatically after install/import. */
  autoTest: boolean
  onAutoTestChange: (value: boolean) => void
  /** Ask the panel to reload the merged catalog after source changes. */
  onCatalogChanged: () => void
}

type Phase = 'loading' | 'ready' | 'error'
type SourceBusy = 'refresh' | 'toggle' | 'delete'

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  Reflect.deleteProperty(next, key)
  return next
}

function sourceLabel(source: MarketSource, t: TFunc): string {
  if (source.id === 'builtin') return t('sourceCurated')
  if (source.id === 'mcp-registry') return t('sourceRegistry')
  if (source.name !== '') return source.name
  return source.id
}

/** Preferences, runtime status, market sources and environment checks. */
export function SettingsTab(props: SettingsTabProps): JSX.Element {
  const { t } = props
  const locale = uiLocale()
  const [status, setStatus] = useState<StationStatus | null>(null)
  const [statusPhase, setStatusPhase] = useState<Phase>('loading')
  const [statusError, setStatusError] = useState('')
  const [doctor, setDoctor] = useState<readonly DoctorCheck[] | null>(null)
  const [doctorPhase, setDoctorPhase] = useState<Phase>('loading')
  const [doctorError, setDoctorError] = useState('')
  const [manualToken, setManualToken] = useState(0)

  const [sources, setSources] = useState<readonly MarketSource[] | null>(null)
  const [sourcesPhase, setSourcesPhase] = useState<Phase>('loading')
  const [sourcesError, setSourcesError] = useState('')
  const [sourceBusy, setSourceBusy] = useState<Record<string, SourceBusy>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [refreshAllBusy, setRefreshAllBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [sourcesToken, setSourcesToken] = useState(0)

  useEffect(() => {
    let active = true
    setStatusPhase('loading')
    setStatusError('')
    setDoctorPhase('loading')
    setDoctorError('')
    void fetchStatus()
      .then((value) => {
        if (!active) return
        setStatus(value)
        setStatusPhase('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setStatusError(errorMessage(cause, t('unknownError')))
        setStatusPhase('error')
      })
    void fetchDoctor()
      .then((payload) => {
        if (!active) return
        setDoctor(payload.checks)
        setDoctorPhase('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setDoctorError(errorMessage(cause, t('unknownError')))
        setDoctorPhase('error')
      })
    return () => {
      active = false
    }
  }, [manualToken, props.refreshToken, t])

  useEffect(() => {
    let active = true
    setSourcesPhase('loading')
    setSourcesError('')
    void fetchSources()
      .then((payload) => {
        if (!active) return
        setSources(Array.isArray(payload.sources) ? payload.sources : [])
        setSourcesPhase('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setSourcesError(errorMessage(cause, t('unknownError')))
        setSourcesPhase('error')
      })
    return () => {
      active = false
    }
  }, [props.refreshToken, sourcesToken, t])

  const busy = statusPhase === 'loading' || doctorPhase === 'loading'
  const refresh = (): void => {
    setManualToken(value => value + 1)
    setSourcesToken(value => value + 1)
  }

  const copy = (text: string): void => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) {
      props.onToast('error', t('toastCopyFailed'))
      return
    }
    void clipboard
      .writeText(text)
      .then(() => {
        props.onToast('success', t('toastCopied'))
      })
      .catch(() => {
        props.onToast('error', t('toastCopyFailed'))
      })
  }

  const replaceSource = (next: MarketSource): void => {
    setSources(current => (current === null ? [next] : current.map(item => (item.id === next.id ? next : item))))
  }

  const runSourceRefresh = (source: MarketSource): void => {
    setSourceBusy(current => ({ ...current, [source.id]: 'refresh' }))
    void refreshSources(source.id)
      .then((payload) => {
        if (Array.isArray(payload.sources)) setSources(payload.sources)
        props.onToast('success', t('sourceRefreshed', { count: 1 }))
        props.onCatalogChanged()
      })
      .catch((cause: unknown) => {
        props.onToast('error', t('sourceRefreshFailed', { message: errorMessage(cause, t('unknownError')) }))
      })
      .finally(() => {
        setSourceBusy(current => withoutKey(current, source.id))
      })
  }

  const runRefreshAll = (): void => {
    if (refreshAllBusy) return
    setRefreshAllBusy(true)
    void refreshSources()
      .then((payload) => {
        const next = Array.isArray(payload.sources) ? payload.sources : []
        setSources(next)
        props.onToast('success', t('sourceRefreshed', { count: next.length }))
        props.onCatalogChanged()
      })
      .catch((cause: unknown) => {
        props.onToast('error', t('sourceRefreshFailed', { message: errorMessage(cause, t('unknownError')) }))
      })
      .finally(() => {
        setRefreshAllBusy(false)
      })
  }

  const runSourceToggle = (source: MarketSource): void => {
    const enabled = !source.enabled
    setSourceBusy(current => ({ ...current, [source.id]: 'toggle' }))
    void saveSource({ id: source.id, enabled })
      .then((payload) => {
        replaceSource(payload.source)
        props.onCatalogChanged()
      })
      .catch((cause: unknown) => {
        props.onToast('error', errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setSourceBusy(current => withoutKey(current, source.id))
      })
  }

  const runSourceRemove = (source: MarketSource): void => {
    setSourceBusy(current => ({ ...current, [source.id]: 'delete' }))
    void deleteSource(source.id)
      .then(() => {
        setSources(current => (current === null ? null : current.filter(item => item.id !== source.id)))
        setConfirming(null)
        props.onToast('success', t('sourceRemoved', { name: sourceLabel(source, t) }))
        props.onCatalogChanged()
      })
      .catch((cause: unknown) => {
        props.onToast('error', errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setSourceBusy(current => withoutKey(current, source.id))
      })
  }

  const chrome = status?.chrome
  const failing = doctor === null ? 0 : doctor.filter(check => !check.ok).length
  const sortedSources = sources === null ? [] : sources.slice().sort((left, right) => {
    const builtinDelta = Number(isBuiltinSource(right)) - Number(isBuiltinSource(left))
    if (builtinDelta !== 0) return builtinDelta
    return sourceLabel(left, t).localeCompare(sourceLabel(right, t), locale)
  })
  const sourcesBusy = sourcesPhase === 'loading' || refreshAllBusy

  const renderSourceStatus = (source: MarketSource): JSX.Element => {
    if (source.status === 'ok') return <Badge tone="ok">{t('sourceStatusOk')}</Badge>
    if (source.status === 'error') return <Badge tone="err">{t('sourceStatusError')}</Badge>
    if (source.status === 'disabled') return <Badge tone="plain">{t('sourceStatusDisabled')}</Badge>
    return <Badge tone="warn">{t('sourceStatusUnknown')}</Badge>
  }

  return (
    <div className="ms_section">
      <div className="ms_sectionHead">
        <span className="ms_sectionTitle">{t('statusTitle')}</span>
        <span className="ms_spacer" />
        <button className="ms_btn" type="button" onClick={refresh} disabled={busy}>
          {busy ? <Spinner /> : null}
          {t('refreshStatus')}
        </button>
      </div>

      {statusPhase === 'loading' ? <LoadingState label={t('loading')} /> : null}
      {statusPhase === 'error' ? (
        <ErrorState message={statusError === '' ? t('settingsLoadFailed') : statusError} retryLabel={t('retry')} onRetry={refresh} />
      ) : null}
      {statusPhase === 'ready' && status !== null ? (
        <div className="ms_card">
          <dl className="ms_kv">
            <dt>{t('fieldPluginVersion')}</dt>
            <dd>{status.pluginVersion}</dd>
            <dt>{t('fieldDshVersion')}</dt>
            <dd>{status.dshVersion}</dd>
            <dt>{t('fieldProfile')}</dt>
            <dd>{status.profile}</dd>
            <dt>{t('fieldProfileDir')}</dt>
            <dd className="ms_mono">{status.profileDir}</dd>
            <dt>{t('fieldPatch')}</dt>
            <dd className="ms_kvAction">
              <span className="ms_mono">{status.patchPath}</span>
              <button className="ms_btn ms_btnGhost" type="button" onClick={() => { copy(status.patchPath) }}>
                {t('copy')}
              </button>
            </dd>
            <dt>{t('fieldCatalog')}</dt>
            <dd>{t('fieldCatalogValue', { version: status.catalogVersion, updated: status.catalogUpdated })}</dd>
            <dt>{t('fieldPresets')}</dt>
            <dd>{status.presetCount}</dd>
            <dt>{t('fieldInstalled')}</dt>
            <dd>{status.installedCount}</dd>
            <dt>{t('fieldChrome')}</dt>
            <dd>
              {chrome !== undefined && chrome.available ? (
                <>
                  {chrome.version === undefined ? '' : chrome.version + ' '}
                  <span className="ms_meta">{t('chromeHint')}</span>
                </>
              ) : (
                <span className="ms_warnText">{t('chromeMissing')}</span>
              )}
            </dd>
            {chrome !== undefined && chrome.path === undefined ? null : (
              <>
                <dt>{t('fieldChromePath')}</dt>
                <dd className="ms_mono">{chrome?.path ?? ''}</dd>
              </>
            )}
            <dt>{t('fieldPlaywright')}</dt>
            <dd>
              {(status.playwrightBrowsers ?? []).length === 0 ? (
                <span className="ms_meta">{t('none')}</span>
              ) : (
                status.playwrightBrowsers.map(browser => (
                  <Badge key={browser} tone="plain">
                    {browser}
                  </Badge>
                ))
              )}
            </dd>
          </dl>
          {status.warnings.length === 0 ? null : (
            <div className="ms_warnBox">
              <span className="ms_warnBoxTitle">{t('warningsTitle')}</span>
              <ul className="ms_warnList">
                {status.warnings.map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      <div className="ms_sectionHead">
        <span className="ms_sectionTitle">{t('languageLabel')}</span>
      </div>
      <div className="ms_card">
        <div className="ms_switchRow">
          <div className="ms_switchText">
            <span className="ms_switchTitle">{t('languageLabel')}</span>
            <span className="ms_meta">{t('languageHint')}</span>
          </div>
          <select
            className="ms_select"
            aria-label={t('languageLabel')}
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
        </div>
      </div>

      <div className="ms_sectionHead">
        <span className="ms_sectionTitle">{t('automationTitle')}</span>
      </div>
      <div className="ms_card">
        <div className="ms_switchRow">
          <div className="ms_switchText">
            <span className="ms_switchTitle">{t('autoTestLabel')}</span>
            <span className="ms_meta">{t('autoTestHint')}</span>
          </div>
          <Switch checked={props.autoTest} label={t('autoTestLabel')} onChange={props.onAutoTestChange} />
        </div>
      </div>

      <div className="ms_sectionHead">
        <span className="ms_sectionTitle">{t('sourceTitle')}</span>
        <span className="ms_spacer" />
        <button className="ms_btn" type="button" onClick={runRefreshAll} disabled={sourcesBusy}>
          {refreshAllBusy ? <Spinner /> : null}
          {t('sourceRefreshAll')}
        </button>
        <button className="ms_btn ms_btnPrimary" type="button" onClick={() => { setAddOpen(true) }}>
          {t('sourceAdd')}
        </button>
      </div>

      {sourcesPhase === 'loading' ? <LoadingState label={t('loading')} /> : null}
      {sourcesPhase === 'error' ? (
        <ErrorState
          message={sourcesError === '' ? t('sourceLoadFailed') : sourcesError}
          retryLabel={t('retry')}
          onRetry={() => {
            setSourcesToken(value => value + 1)
          }}
        />
      ) : null}
      {sourcesPhase === 'ready' && sortedSources.length === 0 ? <EmptyState title={t('sourceEmpty')} /> : null}
      {sourcesPhase === 'ready' && sortedSources.length > 0 ? (
        <div className="ms_card">
          <div className="ms_sourceList">
            {sortedSources.map((source) => {
              const builtin = isBuiltinSource(source)
              const action = sourceBusy[source.id]
              const dirty = action !== undefined
              const count = source.entryCount
              const refreshedAt = source.lastFetchedAt
              const time = refreshedAt === undefined ? '' : formatClock(refreshedAt, locale)
              const label = sourceLabel(source, t)
              return (
                <div className="ms_sourceRow" key={source.id}>
                  <div className="ms_sourceMain">
                    <span className="ms_sourceName" title={label}>
                      {label}
                    </span>
                    {builtin ? <Badge tone="plain">{t('sourceBuiltin')}</Badge> : null}
                    {renderSourceStatus(source)}
                    <span className="ms_meta">{t('sourceItems', { count })}</span>
                    <span className="ms_meta">
                      {time === '' ? t('sourceNeverRefreshed') : t('sourceLastRefresh', { time })}
                    </span>
                    <span className="ms_sourceActions">
                      {builtin ? null : (
                        <>
                          <Switch
                            checked={source.enabled}
                            disabled={dirty}
                            label={t('toggleAria', { name: label })}
                            onChange={() => {
                              runSourceToggle(source)
                            }}
                          />
                          <button
                            className="ms_btn ms_btnGhost"
                            type="button"
                            disabled={dirty || refreshAllBusy}
                            onClick={() => {
                              runSourceRefresh(source)
                            }}
                          >
                            {action === 'refresh' ? <Spinner /> : null}
                            {t('sourceRefresh')}
                          </button>
                        </>
                      )}
                      {builtin ? null : confirming === source.id ? (
                        <>
                          <span className="ms_confirm" title={t('sourceRemoveHint')}>
                            {t('sourceRemoveConfirm')}
                          </span>
                          <button
                            className="ms_btn"
                            type="button"
                            disabled={dirty}
                            onClick={() => {
                              setConfirming(null)
                            }}
                          >
                            {t('cancel')}
                          </button>
                          <button
                            className="ms_btn ms_btnDanger"
                            type="button"
                            disabled={dirty}
                            onClick={() => {
                              runSourceRemove(source)
                            }}
                          >
                            {action === 'delete' ? <Spinner /> : null}
                            {t('sourceRemove')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="ms_btn ms_btnDanger"
                          type="button"
                          disabled={dirty}
                          title={t('sourceRemoveHint')}
                          onClick={() => {
                            setConfirming(source.id)
                          }}
                        >
                          {t('sourceRemove')}
                        </button>
                      )}
                    </span>
                  </div>
                  {source.url === undefined || source.url === '' ? null : (
                    <span className="ms_sourceUrl ms_mono">{source.url}</span>
                  )}
                  {source.error === undefined || source.error === '' ? null : (
                    <span className="ms_sourceError" role="alert">
                      {source.error}
                    </span>
                  )}
                  {builtin ? <span className="ms_meta">{t('sourceBuiltinHint')}</span> : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="ms_sectionHead">
        <span className="ms_sectionTitle">{t('doctorTitle')}</span>
        <span className="ms_spacer" />
        {doctorPhase === 'ready' && doctor !== null ? (
          failing === 0 ? (
            <Badge tone="ok">{t('doctorAllOk')}</Badge>
          ) : (
            <Badge tone="err">{t('doctorFailed', { count: failing })}</Badge>
          )
        ) : null}
      </div>

      {doctorPhase === 'loading' ? <LoadingState label={t('loading')} /> : null}
      {doctorPhase === 'error' ? (
        <ErrorState message={doctorError === '' ? t('doctorLoadFailed') : doctorError} retryLabel={t('retry')} onRetry={refresh} />
      ) : null}
      {doctorPhase === 'ready' && doctor !== null ? (
        doctor.length === 0 ? (
          <EmptyState title={t('doctorEmpty')} />
        ) : (
          <ul className="ms_checks">
            {doctor.map(check => (
              <li className="ms_check" key={check.id}>
                <span className="ms_checkIcon" data-ok={check.ok} aria-hidden="true">
                  {check.ok ? '✓' : '!'}
                </span>
                <div className="ms_checkBody">
                  <span className="ms_checkTitle">{localizedText(check.label, locale)}</span>
                  {check.detail === undefined || check.detail === '' ? null : (
                    <span className="ms_checkDetail">{check.detail}</span>
                  )}
                  {check.ok || check.hint === undefined ? null : (
                    <span className="ms_checkHint">{localizedText(check.hint, locale)}</span>
                  )}
                </div>
                <Badge tone={check.ok ? 'ok' : 'err'}>{check.ok ? t('checkPass') : t('checkFail')}</Badge>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {addOpen ? (
        <SourceDialog
          t={t}
          onClose={() => {
            setAddOpen(false)
          }}
          onCreated={(source) => {
            props.onToast('success', t('sourceAdded', { name: sourceLabel(source, t) }))
            setSourcesToken(value => value + 1)
            props.onCatalogChanged()
          }}
        />
      ) : null}
    </div>
  )
}
