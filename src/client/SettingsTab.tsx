/** Settings tab: runtime status, environment doctor and manual refresh. */

import { useEffect, useState, type JSX } from 'react'
import type { DoctorCheck, StationStatus } from '../shared/types.ts'
import { errorMessage, fetchDoctor, fetchStatus } from './api.ts'
import { localizedText, uiLocale } from './locales.ts'
import { Badge, EmptyState, ErrorState, LoadingState, Spinner, Switch, type TFunc } from './ui.tsx'

/** Settings tab properties. */
export interface SettingsTabProps {
  t: TFunc
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void
  /** Bumped by the panel toolbar to refresh from outside this tab. */
  refreshToken: number
  /** Probe servers automatically after install/import. */
  autoTest: boolean
  onAutoTestChange: (value: boolean) => void
}

type Phase = 'loading' | 'ready' | 'error'

/** Runtime status plus environment checks. */
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

  const busy = statusPhase === 'loading' || doctorPhase === 'loading'
  const refresh = (): void => {
    setManualToken(value => value + 1)
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

  const chrome = status?.chrome
  const failing = doctor === null ? 0 : doctor.filter(check => !check.ok).length

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

    </div>
  )
}
