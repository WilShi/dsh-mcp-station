/**
 * Add/edit dialog for custom MCP servers: a plain stdio command or a
 * streamable-HTTP endpoint. Saving rewrites the whole managed row, so both
 * editable config maps are always sent back.
 */

import { useMemo, useState, type JSX } from 'react'
import type { CustomServerRequest, InstalledServer, McpTransport, ProbeResult } from '../shared/types.ts'
import { createCustomServer, errorMessage, updateCustomServer } from './api.ts'
import { formatPairs, isHttpUrl, parseArgs, parsePairs } from './parse.ts'
import { Badge, Modal, Spinner, type TFunc } from './ui.tsx'

/** Options handed to the save callback. */
export interface CustomSavedOptions {
  /** The dialog tests on its own; skip the panel-level auto test. */
  skipAutoTest?: boolean
}

/** Custom-server dialog properties. */
export interface CustomServerDialogProps {
  t: TFunc
  /** Row being edited; absent when adding a new server. */
  editing?: InstalledServer
  /** Names already in use, for client-side duplicate checks. */
  takenNames: readonly string[]
  onClose: () => void
  onSaved: (server: InstalledServer, options?: CustomSavedOptions) => void
  /** Probe an already-saved row and merge the result into the panel. */
  probe: (server: InstalledServer) => Promise<ProbeResult | null>
}

type Phase = 'idle' | 'saving' | 'testing'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/


/** Add or edit one custom MCP server. */
export function CustomServerDialog(props: CustomServerDialogProps): JSX.Element {
  const { t, editing } = props
  const isEdit = editing !== undefined

  const [serverName, setServerName] = useState(editing?.serverName ?? '')
  const [transport, setTransport] = useState<McpTransport>(editing?.transport ?? 'stdio')
  const [command, setCommand] = useState(editing?.command ?? '')
  const [argsText, setArgsText] = useState((editing?.args ?? []).join('\n'))
  const [envText, setEnvText] = useState(formatPairs(editing?.env))
  const [url, setUrl] = useState(editing?.url ?? '')
  const [headersText, setHeadersText] = useState(formatPairs(editing?.headers))

  const [showErrors, setShowErrors] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<InstalledServer | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  const env = useMemo(() => parsePairs(envText), [envText])
  const headers = useMemo(() => parsePairs(headersText), [headersText])
  const busy = phase === 'saving' || phase === 'testing'
  const locked = busy || saved !== null

  const nameError = useMemo(() => {
    const value = serverName.trim()
    if (value === '') return t('requiredServerName')
    if (!NAME_PATTERN.test(value)) return t('invalidServerName')
    if (!isEdit && saved === null && props.takenNames.some(taken => taken.toLowerCase() === value.toLowerCase())) {
      return t('duplicateName', { name: value })
    }
    return ''
  }, [isEdit, props.takenNames, saved, serverName, t])

  const mapErrors = useMemo(() => {
    const result: { env: string; headers: string } = { env: '', headers: '' }
    if (transport === 'stdio' && env.errorLine > 0) {
      result.env = t('invalidPairLine', { line: env.errorLine })
    }
    if (transport !== 'stdio' && headers.errorLine > 0) {
      result.headers = t('invalidPairLine', { line: headers.errorLine })
    }
    return result
  }, [env.errorLine, headers.errorLine, t, transport])

  const commandError = transport === 'stdio' && command.trim() === '' ? t('requiredCommand') : ''
  const urlError =
    transport === 'stdio'
      ? ''
      : url.trim() === ''
        ? t('requiredUrl')
        : isHttpUrl(url.trim())
          ? ''
          : t('invalidUrl')

  const validationFailed =
    nameError !== '' || mapErrors.env !== '' || mapErrors.headers !== '' || commandError !== '' || urlError !== ''

  const submit = (mode: 'save' | 'save-test'): void => {
    if (locked) return
    setShowErrors(true)
    if (validationFailed) return
    setError('')
    const payload: CustomServerRequest = {
      serverName: serverName.trim(),
      transport,
      ...(isEdit ? { enabled: editing.enabled } : {}),
      ...(transport === 'stdio'
        ? { command: command.trim(), args: parseArgs(argsText), env: env.map }
        : { url: url.trim(), headers: headers.map }),
    }
    setPhase('saving')
    const call = isEdit ? updateCustomServer : createCustomServer
    void call(payload)
      .then((result) => {
        const server = result.server
        setShowErrors(false)
        setSaved(server)
        if (mode === 'save') {
          props.onSaved(server)
          props.onClose()
          return
        }
        props.onSaved(server, { skipAutoTest: true })
        return props.probe(server).then((outcome) => {
          setProbe(
            outcome ?? { ok: false, tools: [], toolCount: 0, latencyMs: 0, error: t('testFailed') },
          )
        })
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setPhase('idle')
      })
  }

  const runTest = (): void => {
    if (saved === null || busy) return
    setPhase('testing')
    setProbe(null)
    void props
      .probe(saved)
      .then((outcome) => {
        setProbe(outcome ?? { ok: false, tools: [], toolCount: 0, latencyMs: 0, error: t('testFailed') })
      })
      .finally(() => {
        setPhase('idle')
      })
  }

  const footer =
    saved === null ? (
      <>
        <button className="ms_btn ms_btnGhost" type="button" onClick={props.onClose} disabled={busy}>
          {t('cancel')}
        </button>
        <button className="ms_btn" type="button" onClick={() => { submit('save') }} disabled={busy}>
          {phase === 'saving' ? <Spinner /> : null}
          {t('save')}
        </button>
        <button className="ms_btn ms_btnPrimary" type="button" onClick={() => { submit('save-test') }} disabled={busy}>
          {busy ? <Spinner /> : null}
          {phase === 'testing' ? t('savingTesting') : t('saveAndTest')}
        </button>
      </>
    ) : (
      <>
        <button className="ms_btn ms_btnGhost" type="button" onClick={props.onClose} disabled={busy}>
          {t('importDone')}
        </button>
        <button className="ms_btn" type="button" onClick={runTest} disabled={busy}>
          {phase === 'testing' ? <Spinner /> : null}
          {phase === 'testing' ? t('testing') : t('test')}
        </button>
      </>
    )

  return (
    <Modal
      title={isEdit ? t('editCustomTitle', { name: editing.serverName }) : t('addCustomTitle')}
      t={t}
      onClose={props.onClose}
      busy={phase === 'saving'}
      footer={footer}
    >
      {saved === null ? null : (
        <div className="ms_okBox" role="status">
          <span>{t('savedLabel')}</span>
          <span className="ms_mono">{saved.serverName}</span>
        </div>
      )}
      {saved === null || probe === null ? null : (
        <div className={probe.ok ? 'ms_okBox' : 'ms_errorBox'} role="status">
          {probe.ok ? (
            <>
              <span>{t('testOk', { count: probe.toolCount, ms: probe.latencyMs })}</span>
            </>
          ) : (
            <>
              <span className="ms_errorBoxTitle">{t('testFailed')}</span>
              <span>{probe.error ?? t('unknownError')}</span>
            </>
          )}
        </div>
      )}
      {saved !== null && probe === null && phase === 'testing' ? (
        <div className="ms_loading">
          <Spinner />
          <span>{t('savingTesting')}</span>
        </div>
      ) : null}

      <div className="ms_field">
        <label className="ms_label" htmlFor="ms_custom_name">
          <span>{t('fieldServerName')}</span>
          <span className="ms_reqMark" aria-hidden="true">*</span>
        </label>
        <input
          id="ms_custom_name"
          className="ms_input ms_inputMono"
          value={serverName}
          placeholder="my-server"
          autoComplete="off"
          spellCheck={false}
          disabled={locked || isEdit}
          aria-invalid={showErrors && nameError !== ''}
          aria-describedby={showErrors && nameError !== '' ? 'ms_custom_name_hint ms_custom_name_error' : 'ms_custom_name_hint'}
          data-autofocus="true"
          onChange={(event) => {
            setServerName(event.target.value)
          }}
        />
        <p className="ms_fieldHint" id="ms_custom_name_hint">
          {isEdit ? t('serverNameLocked') : t('serverNameHint')}
        </p>
        {showErrors && nameError !== '' ? (
          <p className="ms_fieldError" id="ms_custom_name_error">
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="ms_field">
        <span className="ms_label">{t('fieldTransport')}</span>
        <div className="ms_segment" role="group" aria-label={t('fieldTransport')}>
          {(['stdio', 'streamable-http'] as const).map(option => (
            <button
              key={option}
              className="ms_segmentBtn"
              type="button"
              data-on={transport === option}
              aria-pressed={transport === option}
              disabled={locked}
              onClick={() => {
                setTransport(option)
              }}
            >
              {option === 'stdio' ? t('transportStdio') : t('transportHttp')}
            </button>
          ))}
        </div>
      </div>

      {transport === 'stdio' ? (
        <>
          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_custom_command">
              <span>{t('fieldCommand')}</span>
              <span className="ms_reqMark" aria-hidden="true">*</span>
            </label>
            <input
              id="ms_custom_command"
              className="ms_input ms_inputMono"
              value={command}
              placeholder="npx"
              autoComplete="off"
              spellCheck={false}
              disabled={locked}
              aria-invalid={showErrors && commandError !== ''}
              aria-describedby={showErrors && commandError !== '' ? 'ms_custom_command_hint ms_custom_command_error' : 'ms_custom_command_hint'}
              onChange={(event) => {
                setCommand(event.target.value)
              }}
            />
            <p className="ms_fieldHint" id="ms_custom_command_hint">
              {t('commandHint')}
            </p>
            {showErrors && commandError !== '' ? (
              <p className="ms_fieldError" id="ms_custom_command_error">
                {commandError}
              </p>
            ) : null}
          </div>

          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_custom_args">
              <span>{t('fieldArgs')}</span>
              <span className="ms_optional">{t('fieldOptional')}</span>
            </label>
            <textarea
              id="ms_custom_args"
              className="ms_textarea ms_textareaMono"
              value={argsText}
              placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/project'}
              spellCheck={false}
              rows={3}
              disabled={locked}
              onChange={(event) => {
                setArgsText(event.target.value)
              }}
            />
            <p className="ms_fieldHint">{t('argsHint')}</p>
          </div>

          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_custom_env">
              <span>{t('fieldEnv')}</span>
              <span className="ms_optional">{t('fieldOptional')}</span>
            </label>
            <textarea
              id="ms_custom_env"
              className="ms_textarea ms_textareaMono"
              value={envText}
              placeholder={'API_KEY=env:MY_API_KEY'}
              spellCheck={false}
              rows={3}
              disabled={locked}
              aria-invalid={showErrors && mapErrors.env !== ''}
              aria-describedby={showErrors && mapErrors.env !== '' ? 'ms_custom_env_hint ms_custom_env_error' : 'ms_custom_env_hint'}
              onChange={(event) => {
                setEnvText(event.target.value)
              }}
            />
            <p className="ms_fieldHint" id="ms_custom_env_hint">
              {t('pairsHint')}
            </p>
            {showErrors && mapErrors.env !== '' ? (
              <p className="ms_fieldError" id="ms_custom_env_error">
                {mapErrors.env}
              </p>
            ) : null}
            {env.jsValues.length === 0 ? null : <p className="ms_fieldError">{t('jsValueWarning')}</p>}
          </div>
        </>
      ) : (
        <>
          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_custom_url">
              <span>{t('fieldUrl')}</span>
              <span className="ms_reqMark" aria-hidden="true">*</span>
            </label>
            <input
              id="ms_custom_url"
              className="ms_input ms_inputMono"
              value={url}
              placeholder="https://example.com/mcp"
              autoComplete="off"
              spellCheck={false}
              disabled={locked}
              aria-invalid={showErrors && urlError !== ''}
              aria-describedby={showErrors && urlError !== '' ? 'ms_custom_url_error' : undefined}
              onChange={(event) => {
                setUrl(event.target.value)
              }}
            />
            {showErrors && urlError !== '' ? (
              <p className="ms_fieldError" id="ms_custom_url_error">
                {urlError}
              </p>
            ) : null}
          </div>

          <div className="ms_field">
            <label className="ms_label" htmlFor="ms_custom_headers">
              <span>{t('fieldHeaders')}</span>
              <span className="ms_optional">{t('fieldOptional')}</span>
            </label>
            <textarea
              id="ms_custom_headers"
              className="ms_textarea ms_textareaMono"
              value={headersText}
              placeholder={'Authorization=env:MY_TOKEN'}
              spellCheck={false}
              rows={3}
              disabled={locked}
              aria-invalid={showErrors && mapErrors.headers !== ''}
              aria-describedby={showErrors && mapErrors.headers !== '' ? 'ms_custom_headers_hint ms_custom_headers_error' : 'ms_custom_headers_hint'}
              onChange={(event) => {
                setHeadersText(event.target.value)
              }}
            />
            <p className="ms_fieldHint" id="ms_custom_headers_hint">
              {t('pairsHint')}
            </p>
            {showErrors && mapErrors.headers !== '' ? (
              <p className="ms_fieldError" id="ms_custom_headers_error">
                {mapErrors.headers}
              </p>
            ) : null}
            {headers.jsValues.length === 0 ? null : <p className="ms_fieldError">{t('jsValueWarning')}</p>}
          </div>
        </>
      )}

      {error === '' ? null : (
        <div className="ms_errorBox" role="alert">
          <span className="ms_errorBoxTitle">{t('customSaveFailed')}</span>
          <span>{error}</span>
        </div>
      )}
      {saved === null ? null : (
        <div className="ms_cardBadges">
          <Badge tone="info">{saved.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</Badge>
          <Badge tone="plain">{t('customBadge')}</Badge>
        </div>
      )}
    </Modal>
  )
}