/**
 * Install dialog: renders the preset's `inputs` as a dynamic form, shows the
 * risk reasons and note, and reports installing/success/failure inline.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { CatalogPreset, InstalledServer, PresetInput } from '../shared/types.ts'
import { errorMessage, installServer } from './api.ts'
import { localizedText, uiLocale } from './locales.ts'
import { Badge, Modal, RiskBadge, Spinner, cx, type TFunc } from './ui.tsx'

/** Install dialog properties. */
export interface InstallDialogProps {
  preset: CatalogPreset
  t: TFunc
  onClose: () => void
  onInstalled: (server: InstalledServer) => void
}

type Phase = 'idle' | 'submitting' | 'success' | 'error'

function inputPlaceholder(input: PresetInput): string | undefined {
  if (input.placeholder !== undefined && input.placeholder !== '') return input.placeholder
  return input.default !== undefined && input.default !== '' ? input.default : undefined
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function inputKinds(input: PresetInput): { type: string; mono: boolean; hint: 'secret' | 'path' | 'url' | 'default' } {
  if (input.kind === 'secret') return { type: 'password', mono: true, hint: 'secret' }
  if (input.kind === 'path') return { type: 'text', mono: true, hint: 'path' }
  if (input.kind === 'url') return { type: 'url', mono: true, hint: 'url' }
  return { type: 'text', mono: false, hint: 'default' }
}

/** Single most useful hint line under one field. */
function fieldHint(input: PresetInput, kind: 'secret' | 'path' | 'url' | 'default', t: TFunc): string {
  if (kind === 'secret') return t('secretHint')
  if (kind === 'url') return t('urlHint')
  if (input.default !== undefined && input.default !== '') return t('defaultValueHint')
  if (kind === 'path') return t('pathHint')
  return t('defaultValueHint')
}

/** Install dialog for one catalog preset. */
export function InstallDialog(props: InstallDialogProps): JSX.Element {
  const { preset, t } = props
  const inputs = preset.inputs ?? []
  const name = localizedText(preset.displayName) || preset.serverName
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const input of inputs) {
      const fallback = input.default
      if (fallback !== undefined && fallback !== '' && !fallback.includes('{{')) initial[input.key] = fallback
    }
    return initial
  })
  const [showErrors, setShowErrors] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const closeTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const validation = useMemo(() => {
    const errors: Record<string, string> = {}
    for (const input of inputs) {
      const value = (values[input.key] ?? '').trim()
      if (input.required === true && value === '' && input.default === undefined) {
        errors[input.key] = t('fieldRequired')
        continue
      }
      if (input.kind === 'url' && value !== '' && !isHttpUrl(value)) errors[input.key] = t('invalidUrl')
    }
    return errors
  }, [inputs, t, values])

  const locale = uiLocale()
  const reasons = (preset.risk.reasons ?? []).map(reason => localizedText(reason, locale)).filter(reason => reason !== '')
  const note = preset.note === undefined ? '' : localizedText(preset.note, locale)
  const busy = phase === 'submitting'

  const submit = (): void => {
    if (busy || phase === 'success') return
    setShowErrors(true)
    if (Object.keys(validation).length > 0) return
    setPhase('submitting')
    setError('')
    const payload: Record<string, string> = {}
    for (const input of inputs) {
      const value = (values[input.key] ?? '').trim()
      if (value !== '') payload[input.key] = value
    }
    void installServer({ presetId: preset.id, values: payload })
      .then((result) => {
        setPhase('success')
        props.onInstalled(result.server)
        closeTimer.current = window.setTimeout(props.onClose, 1200)
      })
      .catch((cause: unknown) => {
        setPhase('error')
        setError(errorMessage(cause, t('unknownError')))
      })
  }

  const footer = (
    <>
      <button className="ms_btn ms_btnGhost" type="button" onClick={props.onClose} disabled={busy}>
        {t('cancel')}
      </button>
      <button className="ms_btn ms_btnPrimary" type="button" onClick={submit} disabled={busy || phase === 'success'}>
        {busy ? <Spinner /> : null}
        {busy ? t('installBusy') : phase === 'success' ? t('installSuccess') : t('installSubmit')}
      </button>
    </>
  )

  return (
    <Modal title={t('installTitle', { name })} t={t} onClose={props.onClose} busy={busy} footer={footer}>
      <div className="ms_cardBadges">
        <Badge tone="info">{preset.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</Badge>
        <RiskBadge level={preset.risk.level} reasons={preset.risk.reasons} t={t} />
        <span className="ms_mono">{preset.serverName}</span>
      </div>

      {note === '' ? null : (
        <div className="ms_note">
          <span className="ms_noteIcon" aria-hidden="true">i</span>
          <span>{note}</span>
        </div>
      )}

      {reasons.length === 0 ? null : (
        <div className="ms_riskBox">
          <span className="ms_riskBoxTitle">{t('riskReasons')}</span>
          <ul className="ms_riskList">
            {reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {inputs.length === 0 ? (
        <p className="ms_fieldHint">{t('noInputs')}</p>
      ) : (
        inputs.map((input) => {
          const fieldId = 'ms_input_' + input.key
          const value = values[input.key] ?? ''
          const message = showErrors ? validation[input.key] : undefined
          const kind = inputKinds(input)
          const describedBy = message === undefined ? undefined : fieldId + '_error'
          return (
            <div className="ms_field" key={input.key}>
              <label className="ms_label" htmlFor={fieldId}>
                <span>{localizedText(input.label, locale)}</span>
                {input.required === true ? (
                  <span className="ms_reqMark" aria-hidden="true">*</span>
                ) : (
                  <span className="ms_optional">{t('fieldOptional')}</span>
                )}
              </label>
              <input
                id={fieldId}
                className={cx('ms_input', kind.mono && 'ms_inputMono')}
                type={kind.type}
                value={value}
                placeholder={inputPlaceholder(input)}
                autoComplete="off"
                spellCheck={false}
                aria-required={input.required === true}
                aria-invalid={message !== undefined}
                aria-describedby={describedBy}
                data-autofocus={input === inputs[0] ? 'true' : undefined}
                disabled={busy || phase === 'success'}
                onChange={(event) => {
                  const next = event.target.value
                  setValues(current => ({ ...current, [input.key]: next }))
                }}
              />
              {localizedText(input.description, locale) === '' ? null : (
                <p className="ms_fieldHint">{localizedText(input.description, locale)}</p>
              )}
              <p className="ms_fieldHint">{fieldHint(input, kind.hint, t)}</p>
              {message === undefined ? null : (
                <p className="ms_fieldError" id={fieldId + '_error'}>
                  {message}
                </p>
              )}
            </div>
          )
        })
      )}

      {phase === 'error' ? (
        <div className="ms_errorBox" role="alert">
          <span className="ms_errorBoxTitle">{t('installFailed')}</span>
          <span>{error}</span>
        </div>
      ) : null}
      {phase === 'success' ? (
        <div className="ms_okBox" role="status">
          <span>{t('installSuccess')}</span>
          <span className="ms_mono">{preset.serverName}</span>
        </div>
      ) : null}
    </Modal>
  )
}
