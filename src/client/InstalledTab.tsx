/** Installed tab: connection state, tools, test/toggle/edit/remove actions. */

import { useMemo, useState, type JSX } from 'react'
import type { InstalledServer, ServerStatus } from '../shared/types.ts'
import { applyProbe, errorMessage, removeServer, testServer, toggleServer } from './api.ts'
import { formatClock, localizedText, uiLocale } from './locales.ts'
import { Badge, EmptyState, Spinner, StatusDot, Switch, cx, type TFunc } from './ui.tsx'

/** Installed tab properties. */
export interface InstalledTabProps {
  servers: readonly InstalledServer[]
  t: TFunc
  onPatch: (server: InstalledServer) => void
  onRemove: (serverName: string) => void
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void
  onOpenStore: () => void
  onAddCustom: () => void
  onImportJson: () => void
  onEditCustom: (server: InstalledServer) => void
  /** Rows the panel is probing automatically after an install or import. */
  probing: Record<string, boolean>
  /** Resolve the market source label of an installed row. */
  sourceLabelOf?: (server: InstalledServer) => string | undefined
}

type BusyAction = 'test' | 'toggle' | 'remove'

interface RowNote {
  kind: 'ok' | 'err'
  text: string
}

const STATUS_RANK: Record<ServerStatus, number> = { connected: 0, error: 1, unknown: 2, disabled: 3 }

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  Reflect.deleteProperty(next, key)
  return next
}

function serverLabel(server: InstalledServer, locale: 'zh' | 'en'): string {
  const name = localizedText(server.displayName, locale)
  return name === '' ? server.serverName : name
}

function commandLine(server: InstalledServer): string {
  if (server.transport === 'streamable-http' && server.url !== undefined) return server.url
  if (server.command === undefined) return ''
  return [server.command, ...(server.args ?? [])].join(' ')
}

function isCustomServer(server: InstalledServer): boolean {
  return server.origin === 'station' && server.presetId === undefined
}

/** Installed-server management list. */
export function InstalledTab(props: InstalledTabProps): JSX.Element {
  const { t, servers } = props
  const locale = uiLocale()
  const [busy, setBusy] = useState<Record<string, BusyAction>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, RowNote>>({})
  const [details, setDetails] = useState<Record<string, boolean>>({})

  const sorted = useMemo(() => {
    const list = servers.slice()
    list.sort((left, right) => {
      const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status]
      if (rank !== 0) return rank
      return serverLabel(left, locale).localeCompare(serverLabel(right, locale))
    })
    return list
  }, [locale, servers])

  const setNote = (serverName: string, kind: RowNote['kind'], text: string): void => {
    setNotes(current => ({ ...current, [serverName]: { kind, text } }))
  }

  const clearNote = (serverName: string): void => {
    setNotes(current => withoutKey(current, serverName))
  }

  const runTest = (server: InstalledServer): void => {
    setBusy(current => ({ ...current, [server.serverName]: 'test' }))
    clearNote(server.serverName)
    void testServer(server.serverName)
      .then((payload) => {
        const result = payload.result
        props.onPatch(applyProbe(server, result))
        if (result.ok) {
          setNote(server.serverName, 'ok', t('testOk', { count: result.toolCount, ms: result.latencyMs }))
          props.onToast('success', t('toastTestOk', { name: serverLabel(server, locale) }))
          return
        }
        setNote(server.serverName, 'err', result.error ?? t('testFailed'))
        props.onToast('error', t('toastTestFailed', { name: serverLabel(server, locale) }))
      })
      .catch((cause: unknown) => {
        const message = errorMessage(cause, t('unknownError'))
        setNote(server.serverName, 'err', message)
        props.onToast('error', message)
      })
      .finally(() => {
        setBusy(current => withoutKey(current, server.serverName))
      })
  }

  const runToggle = (server: InstalledServer): void => {
    const enabled = !server.enabled
    setBusy(current => ({ ...current, [server.serverName]: 'toggle' }))
    clearNote(server.serverName)
    void toggleServer({ serverName: server.serverName, enabled })
      .then((payload) => {
        props.onPatch({ ...server, enabled, status: payload.server.status, error: payload.server.error })
        props.onToast('success', t(enabled ? 'toastEnabled' : 'toastDisabled', { name: serverLabel(server, locale) }))
      })
      .catch((cause: unknown) => {
        props.onToast('error', errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setBusy(current => withoutKey(current, server.serverName))
      })
  }

  const runRemove = (server: InstalledServer): void => {
    setBusy(current => ({ ...current, [server.serverName]: 'remove' }))
    void removeServer(server.serverName)
      .then(() => {
        props.onRemove(server.serverName)
        setConfirming(null)
        props.onToast('success', t('toastRemoved', { name: serverLabel(server, locale) }))
      })
      .catch((cause: unknown) => {
        props.onToast('error', errorMessage(cause, t('unknownError')))
      })
      .finally(() => {
        setBusy(current => withoutKey(current, server.serverName))
      })
  }

  const toolbar = (
    <div className="ms_actionsBar">
      <button className="ms_btn" type="button" onClick={props.onAddCustom}>
        {t('addCustom')}
      </button>
      <button className="ms_btn ms_btnGhost" type="button" onClick={props.onImportJson}>
        {t('importJson')}
      </button>
      <span className="ms_spacer" />
      <span className="ms_meta" role="status">
        {t('installedSummary', { count: servers.length })}
      </span>
    </div>
  )

  if (sorted.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          title={t('empty')}
          hint={t('emptyHint')}
          action={
            <div className="ms_row">
              <button className="ms_btn ms_btnPrimary" type="button" onClick={props.onOpenStore}>
                {t('goStore')}
              </button>
              <button className="ms_btn" type="button" onClick={props.onAddCustom}>
                {t('addCustom')}
              </button>
            </div>
          }
        />
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="ms_srvList">
        {sorted.map((server) => {
          const name = serverLabel(server, locale)
          const action = busy[server.serverName]
          const external = server.origin === 'external'
          const custom = isCustomServer(server)
          const sourceName = props.sourceLabelOf?.(server)
          const isProbing = props.probing[server.serverName] === true
          const note = notes[server.serverName]
          const isExpanded = expanded[server.serverName] === true
          const tools = server.tools ?? []
          const toolCount = server.toolCount ?? (tools.length === 0 ? undefined : tools.length)
          const meta = commandLine(server)
          const checkedAt = formatClock(server.lastCheckedAt, locale)
          const disabled = action !== undefined || isProbing
          return (
            <article className="ms_srv" key={server.serverName} data-disabled={!server.enabled} aria-label={name}>
              <div className="ms_srvTop">
                <StatusDot status={server.status} t={t} />
                <span className="ms_srvName" title={server.serverName}>
                  {name}
                </span>
                <Badge tone="plain">{server.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</Badge>
                {sourceName === undefined ? null : (
                  <Badge tone="plain" title={t('storeSourceLabel')}>
                    {sourceName}
                  </Badge>
                )}
                {custom ? <Badge tone="info">{t('customBadge')}</Badge> : null}
                {external ? (
                  <Badge tone="warn" title={t('externalHint')}>
                    {t('originExternal')}
                  </Badge>
                ) : null}
                {isProbing ? (
                  <span className="ms_probing">
                    <Spinner />
                    {t('testing')}
                  </span>
                ) : null}
                {toolCount === undefined ? null : <span className="ms_meta">{t('toolCount', { count: toolCount })}</span>}
                {server.latencyMs === undefined ? null : (
                  <span className="ms_meta">{t('latency', { ms: server.latencyMs })}</span>
                )}
              </div>

              <div className="ms_srvMeta">
                <span className="ms_mono">{server.serverName}</span>
                {meta === '' || meta === server.serverName ? null : (
                  <span className="ms_mono" title={meta}>
                    {meta}
                  </span>
                )}
                <span className="ms_meta">{checkedAt === '' ? t('neverChecked') : t('lastChecked', { time: checkedAt })}</span>
              </div>

              {server.error === undefined || server.error === '' ? null : (() => {
                const lines = server.error.split(/\r?\n/).filter(line => line.trim() !== '')
                const short = (lines[0] ?? server.error).trim()
                const compact = short.length > 160 ? short.slice(0, 160) + '…' : short
                const canExpand = lines.length > 1 || server.error.length > compact.length
                const expanded = details[server.serverName] === true
                return (
                  <div className="ms_errRow" role="alert">
                    {expanded ? (
                      <pre className="ms_errDetails">{server.error}</pre>
                    ) : (
                      <span className="ms_err">{compact}</span>
                    )}
                    {canExpand ? (
                      <button
                        className="ms_btn ms_btnGhost"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => {
                          setDetails(current => ({ ...current, [server.serverName]: !expanded }))
                        }}
                      >
                        {expanded ? t('hideDetails') : t('showDetails')}
                      </button>
                    ) : null}
                    {disabled ? null : (
                      <button className="ms_btn ms_btnGhost" type="button" onClick={() => { runTest(server) }}>
                        {t('retry')}
                      </button>
                    )}
                  </div>
                )
              })()}
              {note === undefined ? null : (
                <div className={note.kind === 'ok' ? 'ms_ok' : 'ms_err'} role="status">
                  {note.text}
                </div>
              )}

              <div className="ms_srvActions">
                <button
                  className="ms_btn"
                  type="button"
                  disabled={disabled || !server.enabled}
                  title={!server.enabled ? t('testDisabledHint') : undefined}
                  onClick={() => {
                    runTest(server)
                  }}
                >
                  {action === 'test' || isProbing ? <Spinner /> : null}
                  {action === 'test' || isProbing ? t('testing') : t('test')}
                </button>

                <Switch
                  checked={server.enabled}
                  disabled={external || disabled}
                  label={t('toggleAria', { name })}
                  onChange={() => {
                    runToggle(server)
                  }}
                />

                {custom ? (
                  <button
                    className="ms_btn"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      props.onEditCustom(server)
                    }}
                  >
                    {t('edit')}
                  </button>
                ) : null}

                {confirming === server.serverName ? (
                  <>
                    <span className="ms_confirm" title={t('removeConfirmHint')}>
                      {t('removeConfirm')}
                    </span>
                    <button
                      className="ms_btn"
                      type="button"
                      disabled={action === 'remove'}
                      onClick={() => {
                        setConfirming(null)
                      }}
                    >
                      {t('cancel')}
                    </button>
                    <button
                      className="ms_btn ms_btnDanger"
                      type="button"
                      disabled={action === 'remove'}
                      onClick={() => {
                        runRemove(server)
                      }}
                    >
                      {action === 'remove' ? <Spinner /> : null}
                      {action === 'remove' ? t('removing') : t('uninstall')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="ms_btn ms_btnDanger"
                      type="button"
                      disabled={external || disabled}
                      title={external ? t('externalHint') : t('removeConfirmHint')}
                      onClick={() => {
                        setConfirming(server.serverName)
                      }}
                    >
                      {t('uninstall')}
                    </button>
                    <button
                      className={cx('ms_btn', 'ms_btnGhost')}
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        setExpanded(current => ({ ...current, [server.serverName]: !isExpanded }))
                      }}
                    >
                      {isExpanded
                        ? t('collapseTools')
                        : toolCount === undefined
                          ? t('expandToolsUnknown')
                          : t('expandTools', { count: toolCount })}
                    </button>
                  </>
                )}
              </div>

              {isExpanded ? (
                tools.length === 0 ? (
                  <p className="ms_meta">{t('noTools')}</p>
                ) : (
                  <ul className="ms_tools">
                    {tools.map(tool => (
                      <li className="ms_tool" key={tool.name}>
                        <div className="ms_row">
                          <span className="ms_toolName">{tool.name}</span>
                          {tool.dangerous === true ? <Badge tone="err">{t('toolDangerous')}</Badge> : null}
                        </div>
                        {tool.description === undefined || tool.description === '' ? null : (
                          <p className="ms_toolDesc">{tool.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </article>
          )
        })}
      </div>
    </>
  )
}
