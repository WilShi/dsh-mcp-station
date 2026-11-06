/**
 * One-time stylesheet injection for the MCP Station panel.
 *
 * Every color resolves through the shell's `--dsw-alias-*` semantic tokens so
 * the UI follows the active light/dark theme. The `light-dark()` fallbacks keep
 * the panel readable when the stylesheet is loaded outside the shell (tests,
 * standalone preview) without hard-coding a single palette.
 */

const STYLE_ID = 'dsh-mcp-station-styles'

const TOKENS = `
.ms_root{
  color-scheme:light dark;
  --ms-text:var(--dsw-alias-label-primary,light-dark(#1f2329,#e8eaed));
  --ms-text2:var(--dsw-alias-label-secondary,light-dark(#5c6370,#9aa0a6));
  --ms-text3:var(--dsw-alias-label-tertiary,light-dark(#8a919d,#6b7280));
  --ms-bg:var(--dsw-alias-bg-base,light-dark(#ffffff,#16181b));
  --ms-surface:var(--dsw-alias-bg-layer-1,light-dark(#f7f8fa,#1c1f23));
  --ms-surface2:var(--dsw-alias-bg-layer-3,light-dark(#eef0f3,#23262a));
  --ms-border:var(--dsw-alias-border-l2,light-dark(#e1e4e8,#2f3338));
  --ms-accent:var(--dsw-alias-state-business-primary,light-dark(#2f6fed,#6ea8ff));
  --ms-accent-fg:var(--dsw-alias-label-primary-foreground,#ffffff);
  --ms-success:var(--dsw-alias-state-success-primary,light-dark(#1a7f4b,#52d68a));
  --ms-error:var(--dsw-alias-state-error-primary,light-dark(#c62828,#ff8a80));
  --ms-warn:var(--dsw-alias-state-warn-primary,light-dark(#a05a00,#f5b955));
  --ms-hover:var(--dsw-alias-interactive-bg-hover,light-dark(rgba(15,23,42,.06),rgba(255,255,255,.07)));
  --ms-mask:var(--dsw-alias-bg-mask-1,light-dark(rgba(15,23,42,.4),rgba(0,0,0,.55)));
  --ms-shadow:0 24px 70px light-dark(rgba(15,23,42,.22),rgba(0,0,0,.55));
  color:var(--ms-text);
  font-family:inherit;
  font-size:13px;
  line-height:1.45;
  -webkit-font-smoothing:antialiased;
}
.ms_root *,.ms_root *::before,.ms_root *::after{box-sizing:border-box}
.ms_root :focus-visible{outline:2px solid var(--ms-accent);outline-offset:1px}
.ms_mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--ms-text3);word-break:break-all}
.ms_meta{color:var(--ms-text3);font-size:11px}
.ms_spacer{flex:1 1 auto;min-width:0}
.ms_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ms_err{color:var(--ms-error);font-size:12px;word-break:break-word}
.ms_ok{color:var(--ms-success);font-size:12px;word-break:break-word}
.ms_warnText{color:var(--ms-warn);font-size:12px}
`

const LAYOUT = `
.ms_app{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--ms-bg)}
.ms_appEmbedded{flex:1}
.ms_toolbar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--ms-border);background:var(--ms-bg)}
.ms_toolbarText{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.ms_headSub{color:var(--ms-text2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms_headMeta{color:var(--ms-text3);font-size:11px}
.ms_tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--ms-border);background:var(--ms-bg);overflow-x:auto;scrollbar-width:none}
.ms_tabs::-webkit-scrollbar{display:none}
.ms_tab{appearance:none;border:0;background:transparent;color:var(--ms-text2);padding:9px 10px;border-bottom:2px solid transparent;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
.ms_tab:hover{color:var(--ms-text)}
.ms_tab[data-active="true"]{color:var(--ms-text);border-bottom-color:var(--ms-accent);font-weight:600}
.ms_body{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.ms_section{display:flex;flex-direction:column;gap:8px}
.ms_sectionHead{display:flex;align-items:center;gap:8px;padding-top:2px}
.ms_sectionTitle{font-weight:600;font-size:13px;color:var(--ms-text)}
`

const BUTTONS = `
.ms_btn{appearance:none;display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:8px;border:1px solid var(--ms-border);background:var(--ms-surface);color:var(--ms-text);cursor:pointer;white-space:nowrap}
.ms_btn:hover:not(:disabled){background:var(--ms-hover)}
.ms_btn:disabled{opacity:.5;cursor:default}
.ms_btnPrimary{background:var(--ms-accent);border-color:transparent;color:var(--ms-accent-fg);font-weight:500}
.ms_btnPrimary:hover:not(:disabled){background:var(--ms-accent);filter:brightness(1.07)}
.ms_btnGhost{border-color:transparent;background:transparent;color:var(--ms-text2)}
.ms_btnGhost:hover:not(:disabled){background:var(--ms-hover);color:var(--ms-text)}
.ms_btnDanger{color:var(--ms-error);border-color:color-mix(in srgb,var(--ms-error) 45%,transparent)}
.ms_btnDanger:hover:not(:disabled){background:color-mix(in srgb,var(--ms-error) 12%,transparent)}
.ms_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ms-text2);cursor:pointer;flex:none}
.ms_iconBtn:hover:not(:disabled){background:var(--ms-hover);color:var(--ms-text)}
.ms_iconBtn:disabled{opacity:.5;cursor:default}
.ms_spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:ms_spin .7s linear infinite;flex:none}
@keyframes ms_spin{to{transform:rotate(360deg)}}
`

const BADGES = `
.ms_badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;border:1px solid var(--ms-border);background:var(--ms-surface2);color:var(--ms-text2);white-space:nowrap;min-height:18px}
.ms_badge--ok{color:var(--ms-success);border-color:color-mix(in srgb,var(--ms-success) 38%,transparent);background:color-mix(in srgb,var(--ms-success) 12%,transparent)}
.ms_badge--warn{color:var(--ms-warn);border-color:color-mix(in srgb,var(--ms-warn) 38%,transparent);background:color-mix(in srgb,var(--ms-warn) 12%,transparent)}
.ms_badge--err{color:var(--ms-error);border-color:color-mix(in srgb,var(--ms-error) 40%,transparent);background:color-mix(in srgb,var(--ms-error) 12%,transparent)}
.ms_badge--info{color:var(--ms-accent);border-color:color-mix(in srgb,var(--ms-accent) 38%,transparent);background:color-mix(in srgb,var(--ms-accent) 12%,transparent)}
.ms_status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ms-text2);flex:none}
.ms_dot{width:8px;height:8px;border-radius:50%;background:var(--ms-text3);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-text3) 22%,transparent);flex:none}
.ms_dot[data-status="connected"]{background:var(--ms-success);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-success) 24%,transparent)}
.ms_dot[data-status="error"]{background:var(--ms-error);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-error) 24%,transparent)}
.ms_dot[data-status="unknown"]{background:var(--ms-warn);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-warn) 24%,transparent)}
.ms_dot[data-status="disabled"]{background:var(--ms-text3);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-text3) 18%,transparent)}
.ms_switch{appearance:none;position:relative;width:30px;height:18px;padding:0;border:0;border-radius:999px;background:var(--ms-border);cursor:pointer;flex:none;transition:background .15s}
.ms_switch[data-on="true"]{background:var(--ms-success)}
.ms_switch:disabled{opacity:.45;cursor:default}
.ms_switchThumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:#fff;transition:transform .15s}
.ms_switch[data-on="true"] .ms_switchThumb{transform:translateX(12px)}
`

const CARD = `
.ms_card{border:1px solid var(--ms-border);border-radius:12px;background:var(--ms-surface);padding:11px 12px;display:flex;flex-direction:column;gap:7px;min-width:0}
.ms_cardHead{display:flex;align-items:flex-start;gap:8px}
.ms_cardName{font-weight:600;font-size:13px;flex:1;min-width:0;color:var(--ms-text)}
.ms_cardTag{color:var(--ms-text2);font-size:12px;line-height:1.45;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ms_cardBadges{display:flex;align-items:center;flex-wrap:wrap;gap:5px}
.ms_cardFoot{display:flex;align-items:center;gap:7px;margin-top:auto;padding-top:3px;min-width:0}
.ms_link{color:var(--ms-accent);font-size:11px;text-decoration:none;white-space:nowrap}
.ms_link:hover{text-decoration:underline}
.ms_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:10px;align-items:stretch}
.ms_storeCard{min-height:170px}
.ms_storeBar{display:flex;flex-direction:column;gap:8px}
.ms_searchWrap{position:relative;display:flex;align-items:center}
.ms_search{width:100%;font:inherit;font-size:13px;padding:7px 30px 7px 10px;border-radius:9px;border:1px solid var(--ms-border);background:var(--ms-surface);color:var(--ms-text);appearance:none}
.ms_search::placeholder{color:var(--ms-text3)}
.ms_search:focus{outline:none;border-color:var(--ms-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-accent) 25%,transparent)}
.ms_searchClear{position:absolute;right:4px;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ms-text3);cursor:pointer}
.ms_searchClear:hover{background:var(--ms-hover);color:var(--ms-text)}
.ms_chips{display:flex;gap:6px;flex-wrap:wrap}
.ms_chip{appearance:none;font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:999px;border:1px solid var(--ms-border);background:transparent;color:var(--ms-text2);cursor:pointer;white-space:nowrap}
.ms_chip:hover{background:var(--ms-hover);color:var(--ms-text)}
.ms_chip[data-on="true"]{background:color-mix(in srgb,var(--ms-accent) 16%,transparent);border-color:color-mix(in srgb,var(--ms-accent) 45%,transparent);color:var(--ms-text);font-weight:500}
`

const SERVERS = `
.ms_srvList{display:flex;flex-direction:column;gap:9px}
.ms_srv{border:1px solid var(--ms-border);border-radius:12px;background:var(--ms-surface);padding:10px 12px;display:flex;flex-direction:column;gap:7px;min-width:0}
.ms_srv[data-disabled="true"]{opacity:.78}
.ms_srvTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.ms_srvName{font-weight:600;font-size:13px;color:var(--ms-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms_srvMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;font-size:11px;color:var(--ms-text3)}
.ms_srvActions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ms_confirm{font-size:12px;color:var(--ms-warn);font-weight:500}
.ms_tools{list-style:none;margin:0;padding:7px 0 0;display:flex;flex-direction:column;gap:7px;border-top:1px dashed var(--ms-border)}
.ms_tool{display:flex;flex-direction:column;gap:2px;min-width:0}
.ms_toolName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--ms-text);word-break:break-all}
.ms_toolDesc{font-size:11px;color:var(--ms-text2);margin:0}
`

const SETTINGS = `
.ms_kv{display:grid;grid-template-columns:minmax(92px,auto) 1fr;gap:6px 10px;margin:0;align-items:start}
.ms_kv dt{color:var(--ms-text3);font-size:12px}
.ms_kv dd{margin:0;font-size:12px;color:var(--ms-text);word-break:break-all;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ms_kvAction{justify-content:space-between}
.ms_warnBox{border:1px solid color-mix(in srgb,var(--ms-warn) 35%,transparent);background:color-mix(in srgb,var(--ms-warn) 9%,transparent);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.ms_warnBoxTitle{font-size:12px;font-weight:600;color:var(--ms-warn)}
.ms_warnList{margin:0;padding-left:16px;font-size:12px;color:var(--ms-warn);display:flex;flex-direction:column;gap:2px;word-break:break-word}
.ms_checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.ms_check{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:9px;min-width:0}
.ms_check:hover{background:var(--ms-hover)}
.ms_checkIcon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;font-size:10px;font-weight:700;flex:none;margin-top:1px;background:color-mix(in srgb,var(--ms-success) 16%,transparent);color:var(--ms-success)}
.ms_checkIcon[data-ok="false"]{background:color-mix(in srgb,var(--ms-error) 16%,transparent);color:var(--ms-error)}
.ms_checkBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ms_checkTitle{font-size:12.5px;color:var(--ms-text)}
.ms_checkDetail{font-size:11px;color:var(--ms-text3);word-break:break-all}
.ms_checkHint{font-size:11px;color:var(--ms-warn)}
`

const STATES = `
.ms_loading{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ms-text2);font-size:12px;padding:20px 4px}
.ms_errorCard{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--ms-error) 40%,transparent);background:color-mix(in srgb,var(--ms-error) 8%,transparent);border-radius:10px;padding:10px 12px}
.ms_errorText{flex:1;min-width:140px;font-size:12px;color:var(--ms-error);word-break:break-word}
.ms_empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:30px 12px}
.ms_emptyTitle{font-weight:600;font-size:13px;color:var(--ms-text)}
.ms_emptyHint{font-size:12px;color:var(--ms-text3);max-width:34em}
`

const DIALOG = `
.ms_modal{position:fixed;inset:0;z-index:9995;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--ms-mask)}
.ms_dialog{width:min(470px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:14px;box-shadow:var(--ms-shadow);overflow:hidden;color:var(--ms-text);outline:none}
.ms_dialogHead{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--ms-border)}
.ms_dialogTitle{font-weight:600;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms_dialogBody{padding:13px 15px;overflow:auto;display:flex;flex-direction:column;gap:11px}
.ms_dialogFoot{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:11px 15px;border-top:1px solid var(--ms-border);background:var(--ms-surface)}
.ms_field{display:flex;flex-direction:column;gap:4px}
.ms_label{font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px;color:var(--ms-text)}
.ms_reqMark{color:var(--ms-error)}
.ms_optional{color:var(--ms-text3);font-weight:400;font-size:11px}
.ms_input{width:100%;font:inherit;font-size:13px;padding:6px 9px;border-radius:8px;border:1px solid var(--ms-border);background:var(--ms-surface);color:var(--ms-text)}
.ms_input::placeholder{color:var(--ms-text3)}
.ms_input:focus{outline:none;border-color:var(--ms-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-accent) 22%,transparent)}
.ms_input[aria-invalid="true"]{border-color:var(--ms-error)}
.ms_inputMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.ms_fieldHint{font-size:11px;color:var(--ms-text3);margin:0}
.ms_fieldError{font-size:11px;color:var(--ms-error);margin:0}
.ms_note{display:flex;gap:8px;padding:9px 10px;border-radius:9px;border:1px solid var(--ms-border);background:var(--ms-surface2);font-size:12px;color:var(--ms-text2)}
.ms_noteIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:1px solid var(--ms-text3);color:var(--ms-text3);font-size:10px;font-style:italic;margin-top:1px}
.ms_riskBox{border:1px solid color-mix(in srgb,var(--ms-warn) 32%,transparent);background:color-mix(in srgb,var(--ms-warn) 8%,transparent);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.ms_riskBoxTitle{font-size:12px;font-weight:600;color:var(--ms-warn)}
.ms_riskList{margin:0;padding-left:16px;font-size:12px;color:var(--ms-text2);display:flex;flex-direction:column;gap:2px}
.ms_errorBox{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:9px;border:1px solid color-mix(in srgb,var(--ms-error) 42%,transparent);background:color-mix(in srgb,var(--ms-error) 10%,transparent);color:var(--ms-error);font-size:12px;word-break:break-word}
.ms_errorBoxTitle{font-weight:600}
.ms_okBox{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;border:1px solid color-mix(in srgb,var(--ms-success) 40%,transparent);background:color-mix(in srgb,var(--ms-success) 10%,transparent);color:var(--ms-success);font-size:12px}
`

const TOAST = `
.ms_toastRoot{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;max-width:min(440px,92vw)}
.ms_toast{pointer-events:auto;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-radius:10px;border:1px solid var(--ms-border);background:var(--ms-surface2);color:var(--ms-text);font-size:12.5px;box-shadow:0 12px 34px light-dark(rgba(15,23,42,.18),rgba(0,0,0,.5));animation:ms_toastIn .18s ease-out}
.ms_toast[data-kind="success"]{border-color:color-mix(in srgb,var(--ms-success) 40%,transparent)}
.ms_toast[data-kind="error"]{border-color:color-mix(in srgb,var(--ms-error) 45%,transparent)}
.ms_toastText{word-break:break-word}
.ms_toastClose{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ms-text3);cursor:pointer;flex:none}
.ms_toastClose:hover{background:var(--ms-hover);color:var(--ms-text)}
@keyframes ms_toastIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

const DRAWER = `
.ms_overlay{position:fixed;inset:0;z-index:9990;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--ms-mask)}
.ms_panel{width:min(880px,96vw);height:min(820px,90vh);display:flex;flex-direction:column;background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:16px;box-shadow:var(--ms-shadow);overflow:hidden;outline:none;color:var(--ms-text)}
.ms_panelHead{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--ms-border)}
.ms_panelTitle{font-weight:600;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms_panelBody{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ms_footBtn{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-primary,#e8eaed);border-radius:12px;font-family:inherit;font-size:14px;line-height:22px;overflow:hidden}
.ms_footBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.ms_footBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4c8dff);outline-offset:1px}
.ms_footBtnRail{width:36px;height:36px;gap:0;justify-content:center;border-radius:50%;padding:0;margin:4px 0}
`

const RESPONSIVE = `
@media (max-width:760px){
  .ms_grid{grid-template-columns:1fr}
  .ms_overlay{padding:0}
  .ms_panel{width:100%;height:100%;border-radius:0;border:0}
  .ms_kv{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .ms_spin{animation-duration:1.6s}
  .ms_toast{animation:none}
  .ms_switchThumb{transition:none}
}
`


const EXTRA = `
.ms_actionsBar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ms_probing{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ms-text3)}
.ms_errRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ms_errRow .ms_err{flex:1 1 220px;min-width:0}
.ms_errDetails{flex:1 1 100%;margin:0;max-height:170px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;color:var(--ms-error);background:color-mix(in srgb,var(--ms-error) 7%,transparent);border:1px solid color-mix(in srgb,var(--ms-error) 30%,transparent);border-radius:8px;padding:7px 9px}
.ms_textarea{width:100%;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 9px;border-radius:8px;border:1px solid var(--ms-border);background:var(--ms-surface);color:var(--ms-text);min-height:62px;resize:vertical}
.ms_textarea::placeholder{color:var(--ms-text3)}
.ms_textarea:focus{outline:none;border-color:var(--ms-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ms-accent) 22%,transparent)}
.ms_textarea[aria-invalid="true"]{border-color:var(--ms-error)}
.ms_textareaMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.ms_segment{display:inline-flex;align-items:center;border:1px solid var(--ms-border);border-radius:9px;overflow:hidden;background:var(--ms-surface);width:fit-content}
.ms_segmentBtn{appearance:none;border:0;background:transparent;color:var(--ms-text2);font:inherit;font-size:12px;line-height:18px;padding:5px 12px;cursor:pointer;white-space:nowrap}
.ms_segmentBtn:hover:not(:disabled){background:var(--ms-hover);color:var(--ms-text)}
.ms_segmentBtn[data-on="true"]{background:color-mix(in srgb,var(--ms-accent) 16%,transparent);color:var(--ms-text);font-weight:500}
.ms_segmentBtn:disabled{opacity:.55;cursor:default}
.ms_switchRow{display:flex;align-items:flex-start;gap:12px}
.ms_switchText{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.ms_switchTitle{font-size:12.5px;color:var(--ms-text)}
.ms_importResult{display:flex;flex-direction:column;gap:10px}
.ms_resultGroup{display:flex;flex-direction:column;gap:5px}
.ms_resultTitle{font-size:12px;font-weight:600;color:var(--ms-text)}
.ms_nameList{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.ms_nameList li{display:inline-flex;align-items:center;border:1px solid var(--ms-border);background:var(--ms-surface);border-radius:7px;padding:2px 8px;min-width:0}
.ms_importedName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--ms-text);word-break:break-all}
.ms_skippedList{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.ms_skipped{display:flex;flex-direction:column;gap:1px;border:1px solid color-mix(in srgb,var(--ms-warn) 32%,transparent);background:color-mix(in srgb,var(--ms-warn) 8%,transparent);border-radius:8px;padding:6px 9px;min-width:0}
.ms_skippedName{font-size:12px;font-weight:500;color:var(--ms-text);word-break:break-all}
.ms_skippedReason{font-size:11px;color:var(--ms-warn);word-break:break-word}
`

const CSS = [TOKENS, LAYOUT, BUTTONS, BADGES, CARD, SERVERS, SETTINGS, STATES, DIALOG, TOAST, DRAWER, EXTRA, RESPONSIVE].join('\n')

/** Inject the stylesheet if it is not present yet; returns its disposer. */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}
