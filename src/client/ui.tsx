/** Shared presentation kit for the MCP Station panel. */

import { useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LocalizedText, RiskLevel, ServerStatus } from '../shared/types.ts'
import {
  localizedText,
  RISK_LABEL_KEYS,
  uiLocale,
  type StationLocaleKey,
} from './locales.ts'
import { lockBodyScroll } from './scroll.ts'

/** Translate function of the `mcpStation` namespace. */
export type TFunc = (key: StationLocaleKey, params?: Record<string, unknown>) => string

/** Merge class names, dropping empty entries. */
export function cx(...values: readonly (string | false | null | undefined)[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ')
}

/** Inline loading spinner. */
export function Spinner(): JSX.Element {
  return <span className="ms_spin" aria-hidden="true" />
}

/** Centered "still loading" row. */
export function LoadingState(props: { label: string }): JSX.Element {
  return (
    <div className="ms_loading" role="status" aria-live="polite">
      <Spinner />
      <span>{props.label}</span>
    </div>
  )
}

/** Inline error card with an optional retry action. */
export function ErrorState(props: { message: string; onRetry?: () => void; retryLabel: string }): JSX.Element {
  return (
    <div className="ms_errorCard" role="alert">
      <span className="ms_errorText">{props.message}</span>
      {props.onRetry === undefined ? null : (
        <button className="ms_btn" type="button" onClick={props.onRetry}>
          {props.retryLabel}
        </button>
      )}
    </div>
  )
}

/** Empty-state block with an optional call to action. */
export function EmptyState(props: { title: string; hint?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="ms_empty">
      <span className="ms_emptyTitle">{props.title}</span>
      {props.hint === undefined ? null : <span className="ms_emptyHint">{props.hint}</span>}
      {props.action}
    </div>
  )
}

/** Badge tones shared by risk, status and dependency chips. */
export type BadgeTone = 'ok' | 'warn' | 'err' | 'info' | 'plain'

/** Small status pill. */
export function Badge(props: { tone?: BadgeTone; title?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={cx('ms_badge', 'ms_badge--' + (props.tone ?? 'plain'))} title={props.title}>
      {props.children}
    </span>
  )
}

/** Colored risk badge whose tooltip lists the localized reasons. */
export function RiskBadge(props: { level: RiskLevel; reasons?: readonly LocalizedText[]; t: TFunc }): JSX.Element {
  const locale = uiLocale()
  const reasons = (props.reasons ?? [])
    .map(reason => localizedText(reason, locale))
    .filter(reason => reason !== '')
  const label = props.t(RISK_LABEL_KEYS[props.level])
  const tone: BadgeTone = props.level === 'low' ? 'ok' : props.level === 'medium' ? 'warn' : 'err'
  const title = reasons.length === 0 ? label : props.t('riskTitle', { reasons: reasons.join('; ') })
  return <Badge tone={tone} title={title}>{label}</Badge>
}

const STATUS_LABEL_KEYS: Record<ServerStatus, StationLocaleKey> = {
  connected: 'connected',
  error: 'error',
  unknown: 'unknown',
  disabled: 'disabled',
}

/** Connection state dot plus its localized label. */
export function StatusDot(props: { status: ServerStatus; t: TFunc }): JSX.Element {
  const label = props.t(STATUS_LABEL_KEYS[props.status])
  return (
    <span className="ms_status" title={props.t('statusAria', { status: label })}>
      <span className="ms_dot" data-status={props.status} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

/** Accessible on/off switch. */
export function Switch(props: { checked: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void }): JSX.Element {
  return (
    <button
      className="ms_switch"
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled === true}
      data-on={props.checked}
      onClick={() => {
        props.onChange(!props.checked)
      }}
    >
      <span className="ms_switchThumb" />
    </button>
  )
}

/** One transient feedback message. */
export interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

/** Bottom-centered toast stack. */
export function ToastStack(props: { items: readonly ToastItem[]; t: TFunc; onDismiss: (id: number) => void }): JSX.Element | null {
  if (props.items.length === 0) return null
  const stack = (
    <div className="ms_toastRoot ms_root">
      {props.items.map((item) => (
        <div className="ms_toast" data-kind={item.kind} key={item.id} role={item.kind === 'error' ? 'alert' : 'status'}>
          <span className="ms_toastText">{item.message}</span>
          <button
            className="ms_toastClose"
            type="button"
            aria-label={props.t('close')}
            onClick={() => {
              props.onDismiss(item.id)
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
  return typeof document === 'undefined' ? stack : createPortal(stack, document.body)
}

/** Modal dialog properties. */
export interface ModalProps {
  title: string
  t: TFunc
  onClose: () => void
  /** While busy, Esc and backdrop clicks no longer dismiss. */
  busy?: boolean
  children: ReactNode
  footer?: ReactNode
}

/** Modal dialog: portal, focus trap, Esc/backdrop dismiss and focus restore. */
export function Modal(props: ModalProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement
      restoreRef.current = active instanceof HTMLElement ? active : null
    }
    const release = lockBodyScroll()
    const box = boxRef.current
    const target =
      box?.querySelector<HTMLElement>('[data-autofocus="true"]') ??
      box?.querySelector<HTMLElement>('input, textarea, select') ??
      box
    target?.focus()
    return () => {
      release()
      restoreRef.current?.focus()
    }
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (props.busy !== true) props.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const box = boxRef.current
    if (box === null) return
    const nodes = Array.from(
      box.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(node => node.offsetParent !== null)
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const dialog = (
    <div
      className="ms_modal ms_root"
      data-ms-modal="true"
      onClick={() => {
        if (props.busy !== true) props.onClose()
      }}
    >
      <div
        className="ms_dialog"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="ms_dialogHead">
          <span className="ms_dialogTitle">{props.title}</span>
          <button
            className="ms_iconBtn"
            type="button"
            aria-label={props.t('close')}
            disabled={props.busy === true}
            onClick={props.onClose}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ms_dialogBody">{props.children}</div>
        {props.footer === undefined ? null : <div className="ms_dialogFoot">{props.footer}</div>}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
