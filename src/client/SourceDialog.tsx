/**
 * Add-market-source dialog: remote URL plus optional name, language hint and
 * HTTP headers. The host fetches and validates the document.
 */

import { useMemo, useState, type JSX } from 'react'
import type { DisplayLanguage, MarketSource } from '../shared/types.ts'
import { errorMessage, saveSource } from './api.ts'
import { isHttpUrl, parsePairs } from './parse.ts'
import { Modal, Spinner, type TFunc } from './ui.tsx'

/** Add-source dialog properties. */
export interface SourceDialogProps {
  t: TFunc
  onClose: () => void
  onCreated: (source: MarketSource) => void
}

type Phase = 'idle' | 'saving'

/** Add one remote market source. */
export function SourceDialog(props: SourceDialogProps): JSX.Element {
  const { t } = props
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState<DisplayLanguage>('auto')
  const [headersText, setHeadersText] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const busy = phase === 'saving'
  const headers = useMemo(() => parsePairs(headersText), [headersText])

  const urlError =
    url.trim() === '' ? t('sourceRequiredUrl') : isHttpUrl(url.trim()) ? '' : t('invalidUrl')
  const headersError =
    showErrors && headers.errorLine > 0 ? t('invalidPairLine', { line: headers.errorLine }) : ''

  const submit = (): void => {
    if (busy) return
    setShowErrors(true)
    if (urlError !== '' || headers.errorLine > 0) return
    setError('')
    setPhase('saving')
    void saveSource({
      url: url.trim(),
      ...(name.trim() === '' ? {} : { name: name.trim() }),
      ...(language === 'auto' ? {} : { language }),
      ...(Object.keys(headers.map).length === 0 ? {} : { headers: headers.map }),
    })
      .then((payload) => {
        props.onCreated(payload.source)
        props.onClose()
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, t('unknownError')))
        setPhase('idle')
      })
  }

  const footer = (
    <>
      <button className="ms_btn ms_btnGhost" type="button" onClick={props.onClose} disabled={busy}>
        {t('cancel')}
      </button>
      <button className="ms_btn ms_btnPrimary" type="button" onClick={submit} disabled={busy}>
        {busy ? <Spinner /> : null}
        {busy ? t('sourceAddBusy') : t('sourceAddSubmit')}
      </button>
    </>
  )

  return (
    <Modal title={t('sourceAddTitle')} t={t} onClose={props.onClose} busy={busy} footer={footer}>
      <div className="ms_field">
        <label className="ms_label" htmlFor="ms_source_url">
          <span>{t('fieldSourceUrl')}</span>
          <span className="ms_reqMark" aria-hidden="true">*</span>
        </label>
        <input
          id="ms_source_url"
          className="ms_input ms_inputMono"
          value={url}
          placeholder="https://example.com/mcp-catalog.json"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          aria-invalid={showErrors && urlError !== ''}
          aria-describedby={showErrors && urlError !== '' ? 'ms_source_url_hint ms_source_url_error' : 'ms_source_url_hint'}
          data-autofocus="true"
          onChange={(event) => {
            setUrl(event.target.value)
          }}
        />
        <p className="ms_fieldHint" id="ms_source_url_hint">
          {t('sourceUrlHint')}
        </p>
        {showErrors && urlError !== '' ? (
          <p className="ms_fieldError" id="ms_source_url_error">
            {urlError}
          </p>
        ) : null}
      </div>

      <div className="ms_field">
        <label className="ms_label" htmlFor="ms_source_name">
          <span>{t('fieldSourceName')}</span>
          <span className="ms_optional">{t('fieldOptional')}</span>
        </label>
        <input
          id="ms_source_name"
          className="ms_input"
          value={name}
          placeholder="My MCP market"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
      </div>

      <div className="ms_field">
        <label className="ms_label" htmlFor="ms_source_language">
          <span>{t('fieldSourceLanguage')}</span>
          <span className="ms_optional">{t('fieldOptional')}</span>
        </label>
        <select
          id="ms_source_language"
          className="ms_select"
          value={language}
          disabled={busy}
          onChange={(event) => {
            setLanguage(event.target.value === 'zh' ? 'zh' : event.target.value === 'en' ? 'en' : 'auto')
          }}
        >
          <option value="auto">{t('sourceLanguageAuto')}</option>
          <option value="zh">{t('languageZh')}</option>
          <option value="en">{t('languageEn')}</option>
        </select>
      </div>

      <div className="ms_field">
        <label className="ms_label" htmlFor="ms_source_headers">
          <span>{t('fieldSourceHeaders')}</span>
          <span className="ms_optional">{t('fieldOptional')}</span>
        </label>
        <textarea
          id="ms_source_headers"
          className="ms_textarea ms_textareaMono"
          value={headersText}
          placeholder={'Authorization=env:MY_TOKEN'}
          spellCheck={false}
          rows={3}
          disabled={busy}
          aria-invalid={showErrors && headers.errorLine > 0}
          aria-describedby="ms_source_headers_hint"
          onChange={(event) => {
            setHeadersText(event.target.value)
          }}
        />
        <p className="ms_fieldHint" id="ms_source_headers_hint">
          {t('sourceHeadersHint')}
        </p>
        {headersError === '' ? null : <p className="ms_fieldError">{headersError}</p>}
      </div>

      {error === '' ? null : (
        <div className="ms_errorBox" role="alert">
          <span className="ms_errorBoxTitle">{t('sourceAddFailed')}</span>
          <span>{error}</span>
        </div>
      )}
    </Modal>
  )
}
