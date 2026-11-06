/**
 * Import dialog: paste a Claude/Cursor style MCP document, let the host install
 * every valid entry atomically, then show what was imported and why anything
 * was skipped.
 */

import { useState, type JSX } from 'react'
import type { ImportPayload } from '../shared/types.ts'
import { errorMessage, importServers } from './api.ts'
import { Badge, Modal, Spinner, type TFunc } from './ui.tsx'

/** Import dialog properties. */
export interface ImportDialogProps {
  t: TFunc
  onClose: () => void
  onImported: (payload: ImportPayload) => void
}

type Phase = 'idle' | 'importing'

function importedName(server: { serverName?: string; displayName?: { zh: string; en: string } }): string {
  return server.serverName ?? ''
}

/** Paste-a-config import dialog. */
export function ImportDialog(props: ImportDialogProps): JSX.Element {
  const { t } = props
  const [json, setJson] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportPayload | null>(null)

  const busy = phase === 'importing'

  const submit = (): void => {
    if (busy) return
    const text = json.trim()
    if (text === '') {
      setError(t('requiredJson'))
      return
    }
    try {
      JSON.parse(text)
    } catch (cause) {
      setError(t('invalidJson', { message: errorMessage(cause, t('unknownError')) }))
      return
    }
    setError('')
    setPhase('importing')
    void importServers(text)
      .then((payload) => {
        const imported = Array.isArray(payload.imported) ? payload.imported : []
        const skipped = Array.isArray(payload.skipped) ? payload.skipped : []
        const normalized: ImportPayload = { imported, skipped }
        setResult(normalized)
        props.onImported(normalized)
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setPhase('idle')
      })
  }

  const skipped = result?.skipped ?? []
  const imported = result?.imported ?? []

  const footer =
    result === null ? (
      <>
        <button className="ms_btn ms_btnGhost" type="button" onClick={props.onClose} disabled={busy}>
          {t('cancel')}
        </button>
        <button className="ms_btn ms_btnPrimary" type="button" onClick={submit} disabled={busy || json.trim() === ''}>
          {busy ? <Spinner /> : null}
          {busy ? t('importRunning') : t('importSubmit')}
        </button>
      </>
    ) : (
      <button className="ms_btn ms_btnPrimary" type="button" onClick={props.onClose}>
        {t('importDone')}
      </button>
    )

  return (
    <Modal title={t('importTitle')} t={t} onClose={props.onClose} busy={busy} footer={footer}>
      {result === null ? (
        <>
          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_import_json">
              <span>{t('fieldImportJson')}</span>
            </label>
            <textarea
              id="ms_import_json"
              className="ms_textarea ms_textareaMono"
              value={json}
              placeholder={t('importPlaceholder')}
              spellCheck={false}
              rows={9}
              disabled={busy}
              data-autofocus="true"
              onChange={(event) => {
                setJson(event.target.value)
              }}
            />
            <p className="ms_fieldHint">{t('importHelp')}</p>
          </div>
          {error === '' ? null : (
            <div className="ms_errorBox" role="alert">
              <span className="ms_errorBoxTitle">{t('importFailed')}</span>
              <span>{error}</span>
            </div>
          )}
        </>
      ) : (
        <div className="ms_importResult">
          <div className="ms_cardBadges">
            <Badge tone={imported.length === 0 ? 'plain' : 'ok'}>{t('importImported', { count: imported.length })}</Badge>
            <Badge tone={skipped.length === 0 ? 'plain' : 'warn'}>{t('importSkipped', { count: skipped.length })}</Badge>
          </div>
          {imported.length === 0 && skipped.length === 0 ? <p className="ms_fieldHint">{t('importNothing')}</p> : null}
          {imported.length === 0 ? null : (
            <div className="ms_resultGroup">
              <span className="ms_resultTitle">{t('importImportedTitle')}</span>
              <ul className="ms_nameList">
                {imported.map(server => (
                  <li key={importedName(server)}>
                    <span className="ms_importedName">{importedName(server)}</span>
                    {server.toolCount === undefined ? null : (
                      <span className="ms_meta"> · {t('toolCount', { count: server.toolCount })}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skipped.length === 0 ? null : (
            <div className="ms_resultGroup">
              <span className="ms_resultTitle">{t('importSkippedTitle')}</span>
              <ul className="ms_skippedList">
                {skipped.map(entry => (
                  <li className="ms_skipped" key={entry.name + ':' + entry.reason}>
                    <span className="ms_skippedName">{entry.name}</span>
                    <span className="ms_skippedReason">{entry.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
