/** Client registrations for the MCP Station sidebar entry and settings section. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { StationApp } from './App.tsx'
import { en, setUiLocale, zh, type StationLocaleKey } from './locales.ts'
import { lockBodyScroll } from './scroll.ts'
import { injectStyles } from './styles.ts'
import type { TFunc } from './ui.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    mcpStation: StationLocaleKey
  }
}

const NS = 'mcpStation'

/** Stable Client Loader row name. */
export const name = 'dsh-mcp-station'

/** Services read by the client plugin. */
export const inject = ['slots', 'locale']

function StationIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 16
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 2.5v11" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.5h4M8 8h4M8 10.5h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Drawer hosting the full panel; Esc and the backdrop close it. */
function StationDrawer(props: { t: TFunc; onClose: () => void }): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose

  useEffect(() => {
    const release = lockBodyScroll()
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // A modal dialog stacked above owns Escape while it is open.
      if (document.querySelector('[data-ms-modal="true"]') !== null) return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      release()
    }
  }, [])

  return (
    <div
      className="ms_overlay ms_root"
      onClick={() => {
        closeRef.current()
      }}
    >
      <div
        className="ms_panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.t('nav')}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="ms_panelHead">
          <StationIcon size={18} />
          <span className="ms_panelTitle">{props.t('nav')}</span>
          <button
            className="ms_iconBtn"
            type="button"
            onClick={() => {
              closeRef.current()
            }}
            aria-label={props.t('close')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ms_panelBody">
          <StationApp t={props.t} />
        </div>
      </div>
    </div>
  )
}

interface StationButtonProps extends PropsLocale<'mcpStation'> {
  readonly wide?: boolean
}

/** Sidebar footer action that opens the MCP Station drawer. */
function StationButton(props: StationButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    window.setTimeout(() => {
      triggerRef.current?.focus()
    }, 0)
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={props.wide === false ? 'ms_footBtn ms_footBtnRail' : 'ms_footBtn'}
        type="button"
        onClick={() => {
          setOpen(value => !value)
        }}
        title={props.t('nav')}
        aria-label={props.t('nav')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <StationIcon />
        {props.wide === false ? null : <span>{props.t('nav')}</span>}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(<StationDrawer t={props.t} onClose={close} />, document.body)
        : null}
    </>
  )
}

/** Settings section that embeds the same panel without the drawer chrome. */
function StationSettingsSection(props: PropsLocale<'mcpStation'>): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'min(760px, calc(100vh - 180px))',
        minHeight: 360,
      }}
    >
      <StationApp embedded t={props.t} />
    </div>
  )
}

/**
 * Register the sidebar action, settings section, locale dictionaries and stylesheet.
 * @param ctx - Client context that owns the contributions.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  setUiLocale(ctx.locale.getLocale().active)
  ctx.effect(
    () =>
      ctx.on('locale/change', (snapshot) => {
        setUiLocale(snapshot.active)
      }),
    'mcp-station: locale tracking',
  )
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcp-station: dictionaries')
  ctx.effect(injectStyles, 'mcp-station: stylesheet')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'dsh-mcp-station',
            order: 11,
            locale: NS,
          },
          StationButton,
        ),
      ),
    'mcp-station: sidebar action',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-mcp-station',
            order: 56,
            label: () => t('nav'),
            locale: NS,
          },
          StationSettingsSection,
        ),
      ),
    'mcp-station: settings section',
  )
}
