/**
 * Multi-Key Rotation configuration page — the browser half of
 * `@danneleung/dsh-multi-key-rotation`.
 *
 * ## Where this page lives
 *
 * The page is a tab of the Host's *Plugins settings section*: 设置 → 插件
 * renders a tab bar whose cells come from the `settings.plugins.tab` slot,
 * and each cell's contribution is mounted inside its own tab panel with
 * `{ only: row.id }` and no host-rendered form.
 *
 *   - `settings.plugins.tab` (this module) is the seat that the Plugins
 *     section reads its tabs from. A fresh `id` adds a cell beside the
 *     shipped ones; the owner projects the `label` thunk on every render, so
 *     the tab text follows the active locale without re-registering.
 *   - `plugins.bundle.config` / `plugins.row.config` are the Plugin
 *     Manager's own per-bundle configuration seats. They are keyed by package
 *     name and live on the manager page, not in the settings section, so this
 *     page no longer registers there.
 *
 * This page brings its own save control and reads the namespace directly, so
 * it does not depend on a host-rendered form.
 *
 * ## Crash safety
 *
 * The Host blanks a slot entry whose component throws (the console reports
 * `slot entry crashed in '<slot>'`). Every step of this page is therefore
 * contained:
 *
 *   - The registration is NOT gated behind `configForms.whileServed`. That
 *     gate fires only once the Host's settings mirror holds the namespace,
 *     and the mirror has no view at boot — a gated registration never
 *     appears, and the page is simply absent. This page registers directly
 *     and reads the form lazily.
 *   - The form is read through a guard: a missing form, a throwing
 *     `getSnapshot()`, or a half-written section all degrade to "no
 *     configuration" instead of propagating.
 *   - Every remote call is awaited inside a try/catch; a transport failure
 *     becomes a visible message, never an unhandled rejection.
 *   - The component renders a loading, empty, or error state instead of
 *     `null`, so the page never collapses to a blank panel.
 *
 * ## Secrets
 *
 * Key values never leave the Host. The browser asks the Host for each key's
 * remaining share and weekly reset through `/llm-key-pool/api/health`, and
 * writes key values through `ctx.remote.credentials`.
 */

window.__ModuleLoader__.load({
  id: '@danneleung/dsh-multi-key-rotation',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const react = require('react');
    const react_jsx_runtime = require('react/jsx-runtime');
    const _deepseek_ai_dsh_client_store = require('@deepseek-ai/dsh-client-store');

    //#region src/client/style.js
    /**
     * The page's styles.
     *
     * Every rule uses a `--dsw-alias-*` theme token or a `--dsw-radius-*`
     * token, so the page follows the Host's light and dark palettes. The
     * class names carry this plugin's `m_pool_` prefix, so they cannot
     * collide with the Host's own modules.
     */
    const css = [
      '.m_pool_page{align-items:stretch;flex-direction:column;gap:20px;display:flex}',
      '.m_pool_intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;margin:0;max-width:72ch}',
      '.m_pool_bar{align-items:center;gap:10px;flex-wrap:wrap;display:flex}',
      '.m_pool_status{color:var(--dsw-alias-label-secondary);font-size:12px;margin-left:auto}',
      '.m_pool_statusError{color:var(--dsw-alias-state-error-primary)}',
      '.m_pool_banner{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:12px 14px;font-size:13px;line-height:1.6}',
      '.m_pool_bannerError{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}',
      '.m_pool_bannerWarn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}',
      '.m_pool_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);overflow:hidden;background:var(--dsw-alias-bg-module-platform)}',
      '.m_pool_cardHead{align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.m_pool_cardHeadText{flex-direction:column;gap:2px;min-width:0;flex:1;align-items:flex-start;background:transparent;border:none;cursor:pointer;font:inherit;padding:4px 8px;border-radius:var(--dsw-radius-sm);text-align:left;display:flex}',
      '.m_pool_cardHeadText:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.m_pool_cardHeadText:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.m_pool_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:11px}',
      '.m_pool_chevronOpen{transform:rotate(180deg)}',
      '.m_pool_providerName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.m_pool_providerId{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.m_pool_cardBody{border-top:.5px solid var(--dsw-alias-border-l1);padding:16px;flex-direction:column;gap:18px;display:flex}',
      '.m_pool_section{flex-direction:column;gap:10px;display:flex}',
      '.m_pool_sectionHead{align-items:center;gap:8px;display:flex}',
      '.m_pool_sectionTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:500}',
      '.m_pool_hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;margin:0}',
      '.m_pool_empty{border:.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary);font-size:13px;padding:18px;text-align:center}',
      '.m_pool_keyList{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);overflow:hidden}',
      '.m_pool_keyItem{display:block;padding:11px 14px}',
      '.m_pool_keyItem + .m_pool_keyItem{border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.m_pool_keyRow{display:block}',
      '.m_pool_keyTop{align-items:center;gap:10px;display:grid;grid-template-columns:minmax(88px,148px) minmax(0,1fr) auto}',
      '.m_pool_keyNameParked{color:var(--dsw-alias-label-tertiary)}',
      '.m_pool_keyName{background:transparent;border:1px solid transparent;border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:3px 6px;min-width:0;width:100%;text-overflow:ellipsis}',
      '.m_pool_keyName:hover{border-color:var(--dsw-alias-border-l2)}',
      '.m_pool_keyName:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px;border-color:var(--dsw-alias-border-l3)}',
      '.m_pool_keyName::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.m_pool_keyState{align-items:center;gap:8px;min-width:0;display:flex}',
      '.m_pool_keyMask{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.m_pool_keyBottom{align-items:start;gap:10px;display:grid;grid-template-columns:minmax(0,1fr);margin-top:9px}',
  '.m_pool_quotaLines{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.m_pool_quotaLine{align-items:center;gap:8px;display:grid;grid-template-columns:52px minmax(0,1fr) 42px auto;min-width:0}',
  '.m_pool_quotaLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.m_pool_quota{align-items:center;gap:10px;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 42px}',
      '.m_pool_quotaTrack{display:block;background:var(--dsw-alias-bg-layer-3);border-radius:999px;corner-shape:round;height:6px;overflow:hidden;flex:1}',
      '.m_pool_quotaFill{display:block;width:0;background:var(--dsw-alias-state-success-primary);height:100%;transition:width .24s ease}',
      '.m_pool_quotaFillLow{background:var(--dsw-alias-state-warn-primary)}',
      '.m_pool_quotaFillEmpty{background:var(--dsw-alias-state-error-primary)}',
      '.m_pool_quotaValue{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;text-align:right}',
      '.m_pool_quotaReset{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}',
      '.m_pool_keyActions{align-items:center;gap:2px;display:flex}',
  '.m_pool_keyPinned{align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:600;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}',
  '.m_pool_keyPinBtn{align-items:center;justify-content:center;display:inline-flex;width:26px;height:26px;padding:0;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1;cursor:pointer}',
  '.m_pool_keyPinBtn:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
  '.m_pool_keyPinBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.m_pool_addRow{align-items:center;gap:8px;flex-wrap:wrap;display:flex}',
      '.m_pool_input{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;height:32px;padding:0 10px;min-width:0}',
      '.m_pool_input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px;border-color:var(--dsw-alias-border-l3)}',
      '.m_pool_input::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.m_pool_keyInput{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
      '.m_pool_nameInput{width:150px}',
      '.m_pool_textarea{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;min-height:88px;padding:10px 12px;resize:vertical;width:100%}',
      '.m_pool_textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px;border-color:var(--dsw-alias-border-l3)}',
      '.m_pool_textarea::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.m_pool_choiceGroup{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);overflow:hidden}',
      '.m_pool_choiceRow{align-items:flex-start;gap:10px;padding:10px 12px;display:flex}',
      '.m_pool_choiceRow + .m_pool_choiceRow{border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.m_pool_choiceRow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.m_pool_choice{align-items:flex-start;gap:10px;cursor:pointer;flex:1;min-width:0;display:flex}',
      '.m_pool_choice input{accent-color:var(--dsw-alias-brand-primary);flex:none;margin:2px 0 0;width:14px;height:14px}',
      '.m_pool_choice input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.m_pool_choiceText{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}',
      '.m_pool_choiceLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;font-weight:500}',
      '.m_pool_choiceHint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;display:block}',
      '.m_pool_choicePanel{border-left:2px solid var(--dsw-alias-border-l2);padding-left:14px;margin-top:4px;display:flex;flex-direction:column;gap:14px}',
      '.m_pool_fieldRow{align-items:center;gap:10px;flex-wrap:wrap;display:flex}',
      '.m_pool_fieldLabel{color:var(--dsw-alias-label-primary);font-size:13px;flex:1;min-width:120px}',
      '.m_pool_fieldUnit{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}',
      '.m_pool_numberRow{align-items:center;gap:10px;flex-wrap:wrap;display:flex}',
      '.m_pool_numberInput{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:4px 8px;width:76px}',
      '.m_pool_numberInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}',
      '.m_pool_chips{flex-wrap:wrap;gap:6px;display:flex}',
      '.m_pool_chip{background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;corner-shape:round;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:17px;font-weight:500;padding:4px 10px}',
      '.m_pool_chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.m_pool_chipOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
      '.m_pool_chip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.m_pool_btn{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent;padding:0 14px;height:36px}',
      '.m_pool_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.m_pool_btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.m_pool_btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.m_pool_btn:disabled{cursor:not-allowed;opacity:.4}',
      '.m_pool_btnSm{height:28px;font-size:12px;line-height:18px;padding:0 10px;border-radius:var(--dsw-radius-sm)}',
      '.m_pool_btnOutline{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}',
      '.m_pool_btnPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.m_pool_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.m_pool_btnDanger{color:var(--dsw-alias-state-error-primary)}',
      '.m_pool_btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.m_pool_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-size:13px;line-height:1}',
      '.m_pool_iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.m_pool_iconBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.m_pool_iconBtn:disabled{cursor:not-allowed;opacity:.4}',
      '.m_pool_switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.m_pool_switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.m_pool_switch:disabled{cursor:default;opacity:.5}',
      '.m_pool_switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.m_pool_switchThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}',
      '.m_pool_switch[aria-checked=false] .m_pool_switchThumb{background:var(--dsw-alias-switch-thumb)}',
      '.m_pool_switch[aria-checked=true] .m_pool_switchThumb{transform:translate(16px)}',
      '.m_pool_tag{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
      '.m_pool_tagSuccess{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}',
      '.m_pool_tagWarn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}',
      '.m_pool_tagError{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.m_pool_tagInfo{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}',
      '.m_pool_footer{align-items:center;gap:10px;flex-wrap:wrap;display:flex}',
      '.m_pool_footerNote{color:var(--dsw-alias-label-secondary);font-size:12px}',
      // The composer-row indicator: a compact two-bar quota capsule that
      // sits in the composer tool row, immediately before the model
      // selector. The row already lays out this cell, so the capsule is an
      // ordinary inline-flex item: it takes the row's own height and adds
      // nothing to the row's box.
      '.m_pool_indicatorHost{display:inline-flex;position:relative;flex:none;align-items:center;height:28px;margin:0 2px;z-index:1}',
      // The capsule is a plain inline button. It is NOT positioned: fixed,
      // because the composer's seat carries `will-change: transform` and a
      // fixed descendant would resolve its offsets against that seat.
      '.m_pool_indicatorTrigger{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;width:70px;min-height:28px;margin:0;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;line-height:1;user-select:none;transition:background .14s ease,transform .14s ease}',
      '.m_pool_indicatorTrigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.m_pool_indicatorTrigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.m_pool_indicatorTrigger:active{transform:scale(.98)}',
      '.m_pool_indicator{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;min-width:70px;min-height:28px;padding:0 4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;line-height:1;user-select:none;transition:background .14s ease,opacity .14s ease,transform .14s ease}',
      '.m_pool_indicator:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.m_pool_indicator:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.m_pool_indicator:active{transform:scale(.98)}',
      '.m_pool_indicatorRows{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:70px}',
      '.m_pool_indicatorLine{display:inline-flex;align-items:center;gap:4px;width:70px;height:6px}',
      '.m_pool_indicatorLabel{display:inline-block;width:18px;color:var(--dsw-alias-label-tertiary);font-size:9px;font-weight:600;line-height:10px;text-align:right;letter-spacing:.01em}',
      '.m_pool_indicatorTrack{display:block;width:48px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.m_pool_indicatorFill{display:block;height:100%;min-width:0;border-radius:inherit;transition:width .45s cubic-bezier(.3,.7,.4,1),background-color .2s ease}',
      '.m_pool_indicatorFillOk{background:var(--dsw-alias-state-success-primary)}',
      '.m_pool_indicatorFillWarn{background:var(--dsw-alias-state-warn-primary)}',
      '.m_pool_indicatorFillEmpty{background:var(--dsw-alias-state-error-primary)}',
      '.m_pool_indicatorFillMuted{background:var(--dsw-alias-label-tertiary);opacity:.55}',
      '.m_pool_indicatorFillLoading{width:55%;background:linear-gradient(90deg,#7c8cff,#a5b4fc,#7c8cff);background-size:200% 100%;animation:m_pool_indicator_loading 1.4s ease-in-out infinite}',
      '@keyframes m_pool_indicator_loading{0%{background-position:100% 0;opacity:.42}50%{opacity:.9}100%{background-position:0 0;opacity:.42}}',
      // The hover panel: which key is in use, and both windows.
      // The panel is absolutely positioned inside the inline host, which is
      // its containing block, so it opens above the capsule without a
      // portal and without any measurement.
      '.m_pool_indicatorTip{pointer-events:none;box-sizing:border-box;position:absolute;right:0;bottom:calc(100% + 7px);width:264px;max-width:min(264px,calc(100vw - 24px));margin:0;padding:10px 11px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 14px 34px rgba(0,0,0,.28);z-index:1000;line-height:1.35}',
      '.m_pool_indicatorTipHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}',
      '.m_pool_indicatorTipTitle{font-size:12px;font-weight:700;letter-spacing:-.01em}',
      '.m_pool_indicatorTipSub{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.m_pool_indicatorTipLive{color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap}',
      '.m_pool_indicatorTipError{margin:0 0 8px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent);color:var(--dsw-alias-state-error-primary);font-size:10px;line-height:1.45}',
      '.m_pool_indicatorTipEmpty{padding:8px 2px;color:var(--dsw-alias-label-secondary);font-size:10px;text-align:center}',
      '.m_pool_indicatorKey{margin-top:7px;padding:8px 9px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1)}',
      '.m_pool_indicatorKey:first-of-type{margin-top:0}',
      '.m_pool_indicatorKeyActive{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent)}',
      '.m_pool_indicatorKeyHead{display:flex;align-items:center;gap:6px;margin-bottom:6px}',
      '.m_pool_indicatorChip{padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);color:var(--dsw-alias-state-business-primary);font-size:9px;font-weight:700}',
      '.m_pool_indicatorKeyName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:650}',
      '.m_pool_indicatorMetric{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.m_pool_indicatorMetric b{color:var(--dsw-alias-label-primary);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.m_pool_indicatorHint{margin-top:8px;padding-top:7px;border-top:.5px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:9.5px;line-height:1.45}',
      // The pool list: one compact row per key.
      '.m_pool_indicatorPool{margin-top:7px;padding-top:6px;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.m_pool_indicatorPoolRow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 0}',
      '.m_pool_indicatorPoolRowActive{color:var(--dsw-alias-state-business-primary)}',
      '.m_pool_indicatorPoolName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.m_pool_indicatorPoolRowActive .m_pool_indicatorPoolName{color:var(--dsw-alias-state-business-primary)}',
      '.m_pool_indicatorPoolValue{color:var(--dsw-alias-label-tertiary);font-size:10px;font-variant-numeric:tabular-nums}',
      '.m_pool_spinner{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '@media (prefers-reduced-motion: reduce){.m_pool_quotaFill,.m_pool_switchThumb,.m_pool_chevron{transition:none}}',
    ].join('');
    const tagId = 'dsh-multi-key-rotation/KeyRotationPage.module.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-multi-key-rotation';
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    const s = {
      'addRow': 'm_pool_addRow',
      'banner': 'm_pool_banner',
      'bannerError': 'm_pool_bannerError',
      'bannerWarn': 'm_pool_bannerWarn',
      'bar': 'm_pool_bar',
      'btn': 'm_pool_btn',
      'btnDanger': 'm_pool_btnDanger',
      'btnOutline': 'm_pool_btnOutline',
      'btnPrimary': 'm_pool_btnPrimary',
      'btnSm': 'm_pool_btnSm',
      'card': 'm_pool_card',
      'cardBody': 'm_pool_cardBody',
      'cardHead': 'm_pool_cardHead',
      'cardHeadText': 'm_pool_cardHeadText',
      'chips': 'm_pool_chips',
      'chip': 'm_pool_chip',
      'chipOn': 'm_pool_chipOn',
      'chevron': 'm_pool_chevron',
      'chevronOpen': 'm_pool_chevronOpen',
      'choice': 'm_pool_choice',
      'choiceGroup': 'm_pool_choiceGroup',
      'choiceHint': 'm_pool_choiceHint',
      'choiceLabel': 'm_pool_choiceLabel',
      'choicePanel': 'm_pool_choicePanel',
      'choiceRow': 'm_pool_choiceRow',
      'choiceText': 'm_pool_choiceText',
      'fieldLabel': 'm_pool_fieldLabel',
      'fieldRow': 'm_pool_fieldRow',
      'fieldUnit': 'm_pool_fieldUnit',
      'empty': 'm_pool_empty',
      'footer': 'm_pool_footer',
      'footerNote': 'm_pool_footerNote',
      'hint': 'm_pool_hint',
      'iconBtn': 'm_pool_iconBtn',
      'indicator': 'm_pool_indicator',
      'indicatorPool': 'm_pool_indicatorPool',
      'indicatorPoolName': 'm_pool_indicatorPoolName',
      'indicatorPoolRow': 'm_pool_indicatorPoolRow',
      'indicatorPoolRowActive': 'm_pool_indicatorPoolRowActive',
      'indicatorPoolValue': 'm_pool_indicatorPoolValue',
      'indicatorTrigger': 'm_pool_indicatorTrigger',
      'indicatorChip': 'm_pool_indicatorChip',
      'indicatorFill': 'm_pool_indicatorFill',
      'indicatorFillEmpty': 'm_pool_indicatorFillEmpty',
      'indicatorFillLoading': 'm_pool_indicatorFillLoading',
      'indicatorFillMuted': 'm_pool_indicatorFillMuted',
      'indicatorFillOk': 'm_pool_indicatorFillOk',
      'indicatorFillWarn': 'm_pool_indicatorFillWarn',
      'indicatorHint': 'm_pool_indicatorHint',
      'indicatorHost': 'm_pool_indicatorHost',
      'indicatorKey': 'm_pool_indicatorKey',
      'indicatorKeyActive': 'm_pool_indicatorKeyActive',
      'indicatorKeyHead': 'm_pool_indicatorKeyHead',
      'indicatorKeyName': 'm_pool_indicatorKeyName',
      'indicatorLabel': 'm_pool_indicatorLabel',
      'indicatorLine': 'm_pool_indicatorLine',
      'indicatorMetric': 'm_pool_indicatorMetric',
      'indicatorRows': 'm_pool_indicatorRows',
      'indicatorTip': 'm_pool_indicatorTip',
      'indicatorTipEmpty': 'm_pool_indicatorTipEmpty',
      'indicatorTipError': 'm_pool_indicatorTipError',
      'indicatorTipHead': 'm_pool_indicatorTipHead',
      'indicatorTipLive': 'm_pool_indicatorTipLive',
      'indicatorTipSub': 'm_pool_indicatorTipSub',
      'indicatorTipTitle': 'm_pool_indicatorTipTitle',
      'indicatorTrack': 'm_pool_indicatorTrack',
      'input': 'm_pool_input',
      'intro': 'm_pool_intro',
      'keyActions': 'm_pool_keyActions',
      'keyPinned': 'm_pool_keyPinned',
      'keyPinBtn': 'm_pool_keyPinBtn',
      'quotaLines': 'm_pool_quotaLines',
      'quotaLine': 'm_pool_quotaLine',
      'quotaLabel': 'm_pool_quotaLabel',
      'keyBottom': 'm_pool_keyBottom',
      'keyInput': 'm_pool_keyInput',
      'keyList': 'm_pool_keyList',
      'keyMask': 'm_pool_keyMask',
      'keyItem': 'm_pool_keyItem',
      'keyName': 'm_pool_keyName',
      'keyNameParked': 'm_pool_keyNameParked',
      'keyRow': 'm_pool_keyRow',
      'keyState': 'm_pool_keyState',
      'keyTop': 'm_pool_keyTop',
      'nameInput': 'm_pool_nameInput',
      'numberInput': 'm_pool_numberInput',
      'numberRow': 'm_pool_numberRow',
      'page': 'm_pool_page',
      'providerId': 'm_pool_providerId',
      'providerName': 'm_pool_providerName',
      'quota': 'm_pool_quota',
      'quotaFill': 'm_pool_quotaFill',
      'quotaFillEmpty': 'm_pool_quotaFillEmpty',
      'quotaFillLow': 'm_pool_quotaFillLow',
      'quotaReset': 'm_pool_quotaReset',
      'quotaTrack': 'm_pool_quotaTrack',
      'quotaValue': 'm_pool_quotaValue',
      'section': 'm_pool_section',
      'sectionHead': 'm_pool_sectionHead',
      'sectionTitle': 'm_pool_sectionTitle',
      'spinner': 'm_pool_spinner',
      'status': 'm_pool_status',
      'statusError': 'm_pool_statusError',
      'switch': 'm_pool_switch',
      'switchThumb': 'm_pool_switchThumb',
      'tag': 'm_pool_tag',
      'tagError': 'm_pool_tagError',
      'tagInfo': 'm_pool_tagInfo',
      'tagSuccess': 'm_pool_tagSuccess',
      'tagWarn': 'm_pool_tagWarn',
      'textarea': 'm_pool_textarea',
    };
    //#endregion
    //#region src/client/locales.js
    const en = {
      tab: 'Multi-Key Rotation',
      title: 'Multi-Key Rotation',
      description: 'Give one provider several named API keys. Multi-Key Rotation takes the route over as soon as it loads, so your requests authenticate with a pool key instead of the one in Settings → Models. When a key hits a plan quota, a quota, a rate limit, or an auth error, the pool moves to the next key and retries the request — no restart, and the conversation continues.',
      emptyProviders: 'No provider is available for pooling. Add one in Settings → Models first.',
      refresh: 'Refresh usage',
      refreshing: 'Refreshing…',
      loading: 'Loading…',
      keys: 'Pool keys',
      keysHint: 'Each key gets a name so you can tell them apart. A key without a value is never used until you paste one. Once the pool is on, its key is the one the route authenticates with.',
      noKeys: 'This pool has no keys yet.',
      keyNamePlaceholder: 'Name',
      keyValuePlaceholder: 'Paste an API key…',
      saved: 'Saved',
      staged: 'Not saved yet',
      notConfigured: 'No value',
      emptySlot: 'Empty slot',
      parked: 'Parked',
      unnamedKey: 'Unnamed key',
      replace: 'Replace this key',
      replaceHint: 'Paste a new value to replace the stored key.',
      cancel: 'Cancel',
      removeConfirm: 'Remove "{name}"? The stored credential is deleted.',
      park: 'Park this key',
      unpark: 'Return this key to the pool',
      remove: 'Remove this key',
      usageUnavailable: 'Usage unavailable',
      usageError: 'Usage could not be read',
      remaining: 'remaining',
      resetsIn: 'resets in {duration}',
      intervalWindow: '5-hour',
      weeklyWindow: 'weekly',
      durationZero: '0m',
      durationMinutes: '{count}m',
      durationHours: '{hours}h {minutes}m',
      durationDays: '{days}d {hours}h',
      weeklyReset: 'weekly quota resets {duration}',
      addKey: 'Add key',
      bulkAdd: 'Add several at once',
      bulkAddHint: 'Paste one key per line. Each line becomes its own pool slot.',
      bulkPlaceholder: 'sk-cp-…\nsk-cp-…\nsk-cp-…',
      bulkAddButton: 'Add these keys',
      policy: 'When to switch',
      policyFailure: 'Only when a request fails',
      policyFailureHint: 'Keep using the current key until it fails. When it does, the pool is searched for the key whose weekly window resets soonest, and among those the one whose 5-hour window resets soonest — a key that is about to reset is spent before it expires.',
      policyRemaining: 'Also before each request',
      policyRemainingHint: 'The same search runs before every request instead of waiting for a failure: the key whose weekly window resets soonest, then the one whose 5-hour window resets soonest. A key below the threshold rests until its weekly window resets.',
      threshold: 'Rest a key below',
      thresholdHint: 'A key whose remaining quota falls under this percentage rests until its weekly window resets. 0 never rests a key.',
      reserve: 'Hold back above',
      reserveHint: 'A key whose remaining quota is above this percentage is held back in reserve, so the failure path still has a healthy key to use.',
      percent: '%',
      triggers: 'Rotate on',
      triggersHint: 'The failures that make the pool move to another key.',
      triggerTokenPlan: 'Plan quota used up',
      triggerQuota: 'Quota exceeded',
      triggerRateLimit: 'Rate limited',
      triggerAuth: 'Auth failed (401/403)',
      save: 'Save',
      saving: 'Saving…',
      savedOk: 'Saved.',
      savedFail: 'The Host refused the change.',
      unsaved: 'Unsaved changes',
      allSaved: 'Everything is saved.',
      keySaveFailed: 'The key could not be saved.',
      keyRemoved: 'Key removed.',
      keyRemoveFailed: 'The key could not be removed.',
      rotationLabel: 'Key rotation',
      enabled: 'Rotation enabled',
      disabled: 'Rotation off',
      keyCount: '{count} key(s)',
      keyCountOne: '1 key',
      useThisKey: 'Use this key',
      inUse: 'In use',
      pinnedHint: 'The key you pick here is the one the provider starts with. If it fails, the pool still moves on to another key.',
      indicatorTitle: 'Multi-Key Rotation',
      indicatorActiveKey: 'Key in use',
      indicatorNoActiveKey: 'No key in use',
      indicatorLoading: 'Reading usage…',
      indicatorUnavailable: 'Usage unavailable',
      indicatorError: 'Usage could not be read: {message}',
      indicatorNoPool: 'This provider has no key pool.',
      indicatorRefresh: 'Click to refresh',
      indicatorWindowInterval: '5-hour window',
      indicatorWindowWeekly: 'Weekly window',
      indicatorResetsIn: 'resets in {duration}',
      indicatorSummary: 'Multi-Key Rotation — {key}: 5-hour {interval}, weekly {weekly}. Click to refresh.',
    };
    const zh = {
      tab: '多密钥轮换',
      title: '多密钥轮换',
      description: '为同一个提供商配置多个带名称的 API 密钥。插件加载后，多密钥轮换立即接管该路由，请求用的是池里的密钥，而不是「设置 → 模型」里配的那个。当某个密钥达到套餐额度、配额、限流或认证错误时，插件会自动切换到下一个密钥并重试请求 —— 无需重启，对话也不会中断。',
      emptyProviders: '目前没有可用于多密钥轮换的提供商。请先在「设置 → 模型」中添加一个。',
      refresh: '刷新用量',
      refreshing: '刷新中…',
      loading: '加载中…',
      keys: '池内密钥',
      keysHint: '给每个密钥起个名字，方便区分。没有填写值的密钥不会被使用，直到你粘贴一个。插件开启后，路由用的就是池里的密钥。',
      noKeys: '这个池子里还没有密钥。',
      keyNamePlaceholder: '名称',
      keyValuePlaceholder: '粘贴一个 API 密钥…',
      saved: '已保存',
      staged: '尚未保存',
      notConfigured: '没有值',
      emptySlot: '空密钥位',
      parked: '已停用',
      unnamedKey: '未命名密钥',
      replace: '替换此密钥',
      replaceHint: '粘贴新值以替换已保存的密钥。',
      cancel: '取消',
      removeConfirm: '移除「{name}」？已保存的凭据会被删除。',
      park: '停用此密钥',
      unpark: '启用此密钥',
      remove: '移除此密钥',
      usageUnavailable: '无法获取用量',
      usageError: '用量读取失败',
      remaining: '剩余',
      resetsIn: '还剩 {duration}',
      intervalWindow: '五小时',
      weeklyWindow: '每周',
      durationZero: '0 分钟',
      durationMinutes: '{count} 分钟',
      durationHours: '{hours} 小时 {minutes} 分钟',
      durationDays: '{days} 天 {hours} 小时',
      weeklyReset: '周额度还剩 {duration}',
      addKey: '添加密钥',
      bulkAdd: '一次添加多个',
      bulkAddHint: '每行粘贴一个密钥，每行会成为一个独立的密钥位。',
      bulkPlaceholder: 'sk-cp-…\nsk-cp-…\nsk-cp-…',
      bulkAddButton: '添加这些密钥',
      policy: '何时切换',
      policyFailure: '仅在请求失败时',
      policyFailureHint: '一直使用当前密钥，直到它出错。出错时才在池中挑选下一个：优先选周窗口最快重置的密钥，其次是五小时窗口最快重置的密钥——快要重置的密钥先用完，别让它白白过期。',
      policyRemaining: '每次请求前也切换',
      policyRemainingHint: '同样的挑选规则在每次请求前就执行，不用等失败：优先选周窗口最快重置的密钥，其次是五小时窗口最快重置的密钥。低于阈值的密钥会一直休整，直到它的周窗口重置。',
      threshold: '低于此值休整',
      thresholdHint: '剩余额度低于该百分比的密钥会进入休整，直到它的周窗口重置。设为 0 表示不休整任何密钥。',
      reserve: '高于此值预留',
      reserveHint: '剩余额度高于该百分比的密钥会被预留，让故障切换时仍有健康密钥可用。',
      percent: '%',
      triggers: '轮转触发',
      triggersHint: '哪些故障会让插件切换到另一个密钥。',
      triggerTokenPlan: '套餐额度已用完',
      triggerQuota: '配额已用尽',
      triggerRateLimit: '触发限流',
      triggerAuth: '认证失败 (401/403)',
      save: '保存',
      saving: '保存中…',
      savedOk: '已保存。',
      savedFail: '宿主拒绝了这次修改。',
      unsaved: '有未保存的修改',
      allSaved: '所有内容均已保存。',
      keySaveFailed: '密钥保存失败。',
      keyRemoved: '密钥已移除。',
      keyRemoveFailed: '密钥移除失败。',
      rotationLabel: '密钥轮转',
      enabled: '轮转已启用',
      disabled: '轮转已关闭',
      keyCount: '{count} 个密钥',
      keyCountOne: '1 个密钥',
      useThisKey: '使用这个密钥',
      inUse: '使用中',
      pinnedHint: '在这里指定的密钥，就是该提供商默认使用的密钥。如果它失败，插件仍会切换到其他密钥。',
      indicatorTitle: '多密钥轮换',
      indicatorActiveKey: '正在使用',
      indicatorNoActiveKey: '没有正在使用的密钥',
      indicatorLoading: '正在读取用量…',
      indicatorUnavailable: '无法获取用量',
      indicatorError: '用量读取失败：{message}',
      indicatorNoPool: '该提供商没有密钥池。',
      indicatorRefresh: '点击刷新',
      indicatorWindowInterval: '五小时窗口',
      indicatorWindowWeekly: '周窗口',
      indicatorResetsIn: '还剩 {duration}',
      indicatorSummary: '多密钥轮换 — {key}：五小时 {interval}，每周 {weekly}。点击刷新。',
    };
    //#endregion
    //#region src/client/constants.js
    /** The trigger codes the page offers, in the order they are shown. */
    const ROTATE_ON = [
      { code: 'TOKEN_PLAN', labelKey: 'triggerTokenPlan' },
      { code: 'QUOTA', labelKey: 'triggerQuota' },
      { code: 'RATE_LIMIT', labelKey: 'triggerRateLimit' },
      { code: 'AUTH', labelKey: 'triggerAuth' },
    ];
    /** The default trigger codes of a fresh pool. */
    const DEFAULT_ROTATE_ON = ['TOKEN_PLAN', 'QUOTA', 'AUTH'];
    /** The default switching policy of a fresh pool. */
    const DEFAULT_POLICY = { mode: 'failure', thresholdPercent: 0, reservePercent: 0 };
    /** The route's usage endpoint, answered by the Host. */
    const HEALTH_URL = '/llm-key-pool/api/health';
    /**
     * This bundle's package name — also the id of the cell this page
     * occupies in the Plugins settings section's tab bar.
     */
    const BUNDLE_NAME = 'dsh-multi-key-rotation';
    /** The settings namespace this plugin's Host half owns. */
    const NS = 'llm-key-pool';
    /** The dictionary namespace this page owns. */
    const LOCALE_NS = 'settings.keyPool';
    /** How long one settings write may take before the page gives up on it. */
    const WRITE_TIMEOUT_MS = 15000;
    /** The sentinel a timed-out write settles with. */
    const TIMEOUT = Symbol('timeout');

    /**
     * Derive the route's own reference from its provider id by convention.
     * Mirrors the Host's `envRefOf`; the Host owns the naming, this copy only
     * lets the page show which reference receives the active key.
     * @param provider - provider route id.
     * @returns the credential reference.
     */
    function envRefOf(provider) {
      return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    }

    /**
     * Derive the reference holding one pool slot's key. Mirrors the Host's
     * `poolRefOf`.
     * @param provider - provider route id.
     * @param slot - 1-based slot number.
     * @returns the credential reference.
     */
    function poolRefOf(provider, slot) {
      return `${envRefOf(provider)}_POOL_${slot}`;
    }

    /**
     * Read the 1-based slot number out of a derived pool reference.
     * @param ref - candidate reference.
     * @returns the slot number, or undefined when the reference is not derived.
     */
    function slotOfPoolRef(ref) {
      const match = /_API_KEY_POOL_(\d+)$/.exec(ref);
      return match === null ? undefined : Number(match[1]);
    }

    /**
     * Render a duration in the compact form the page shows.
     *
     * The units come from the dictionary, so the Chinese page reads
     * "2 小时 15 分钟" instead of an English "2h 15m" inside a Chinese
     * sentence.
     * @param ms - the duration in milliseconds.
     * @param t - the translator.
     * @returns a short human-readable duration.
     */
    function formatDuration(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return t('durationZero');
      const minutes = Math.floor(ms / 60000);
      if (minutes < 60) return t('durationMinutes', { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return t('durationHours', { hours, minutes: minutes % 60 });
      return t('durationDays', { days: Math.floor(hours / 24), hours: hours % 24 });
    }

    /**
     * Clamp a percentage into the range the Host accepts.
     * @param value - the raw number.
     * @returns the clamped percentage.
     */
    function clampPercent(value) {
      if (!Number.isFinite(value)) return 0;
      return Math.min(100, Math.max(0, Math.round(value)));
    }
    //#endregion
    //#region src/client/indicator.js
    /** How long the indicator waits between two usage probes. */
    const INDICATOR_POLL_MS = 60000;
    /**
     * The share of a window that turns the bar from healthy to low, and from
     * low to empty. These mirror the page's own thresholds, so the composer
     * and the settings card read the same way.
     */
    const INDICATOR_WARN_PERCENT = 20;
    const INDICATOR_EMPTY_PERCENT = 0;

    /**
     * The tone of one quota bar.
     * @param percent - the remaining share, or undefined when unknown.
     * @returns the class name of the bar's fill.
     */
    function indicatorTone(percent) {
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return s.indicatorFillMuted;
      if (percent <= INDICATOR_EMPTY_PERCENT) return s.indicatorFillEmpty;
      if (percent < INDICATOR_WARN_PERCENT) return s.indicatorFillWarn;
      return s.indicatorFillOk;
    }

    /**
     * One compact bar: a short label and the remaining share.
     * @param props - the label, the share, and whether the read is pending.
     */
    function IndicatorBar(props) {
      const percent = typeof props.percent === 'number' && Number.isFinite(props.percent)
        ? Math.max(0, Math.min(100, props.percent))
        : undefined;
      const fillClass = props.loading
        ? `${s.indicatorFill} ${s.indicatorFillLoading}`
        : `${s.indicatorFill} ${indicatorTone(percent)}`;
      const width = props.loading || percent === undefined ? undefined : `${percent}%`;
      return (0, react_jsx_runtime.jsxs)('span', { className: s.indicatorLine, 'aria-hidden': 'true',
        children: [
          (0, react_jsx_runtime.jsx)('span', { className: s.indicatorLabel, children: props.label }),
          (0, react_jsx_runtime.jsx)('span', { className: s.indicatorTrack,
            children: (0, react_jsx_runtime.jsx)('span', { className: fillClass, style: width === undefined ? undefined : { width } }),
          }),
        ],
      });
    }

    /**
     * One line of the hover panel: a label and a value.
     * @param props - the label, the value, and the reset text.
     */
    function IndicatorMetric(props) {
      return (0, react_jsx_runtime.jsxs)('div', { className: s.indicatorMetric,
        children: [
          (0, react_jsx_runtime.jsx)('span', { children: props.reset ? `${props.label} · ${props.reset}` : props.label }),
          (0, react_jsx_runtime.jsx)('b', { children: props.value }),
        ],
      });
    }

    /**
     * The hover panel: every key of the pool, the one in use marked.
     * @param props - the keys, the loading state, the error, and the labels.
     */
    function IndicatorPanel(props) {
      const keys = props.keys;
      const current = keys.find((entry) => entry.current === true);
      // The compact body: the key in use, its two windows, and the pool
      // beside it. Nothing else.
      return (0, react_jsx_runtime.jsxs)('div', { className: s.indicatorTip, role: 'dialog', id: props.id,
        children: [
          (0, react_jsx_runtime.jsxs)('div', { className: s.indicatorTipHead,
            children: [
              (0, react_jsx_runtime.jsx)('span', { className: s.indicatorTipTitle, children: props.t('indicatorTitle') }),
              (0, react_jsx_runtime.jsx)('span', { className: s.indicatorTipLive,
                children: props.loading ? props.t('indicatorLoading') : props.t('indicatorRefresh'),
              }),
            ],
          }),
          props.error !== undefined
            ? (0, react_jsx_runtime.jsx)('div', { className: s.indicatorTipError, children: props.error })
            : null,
          current !== undefined
            ? (0, react_jsx_runtime.jsxs)('div', { className: `${s.indicatorKey} ${s.indicatorKeyActive}`,
              children: [
                (0, react_jsx_runtime.jsxs)('div', { className: s.indicatorKeyHead,
                  children: [
                    (0, react_jsx_runtime.jsx)('span', { className: s.indicatorChip, children: props.t('indicatorActiveKey') }),
                    (0, react_jsx_runtime.jsx)('span', { className: s.indicatorKeyName,
                      children: current.name !== '' ? current.name : current.ref,
                    }),
                  ],
                }),
                (0, react_jsx_runtime.jsx)(IndicatorMetric, {
                  label: props.t('indicatorWindowInterval'),
                  value: current.intervalRemainingPercent === undefined ? '—' : `${Math.round(current.intervalRemainingPercent)}%`,
                  reset: current.intervalResetAt === undefined
                    ? undefined
                    : props.t('indicatorResetsIn', { duration: formatDuration(current.intervalResetAt - Date.now(), props.t) }),
                }),
                (0, react_jsx_runtime.jsx)(IndicatorMetric, {
                  label: props.t('indicatorWindowWeekly'),
                  value: current.weeklyRemainingPercent === undefined ? '—' : `${Math.round(current.weeklyRemainingPercent)}%`,
                  reset: current.weeklyResetAt === undefined
                    ? undefined
                    : props.t('indicatorResetsIn', { duration: formatDuration(current.weeklyResetAt - Date.now(), props.t) }),
                }),
              ],
            })
            : null,
          keys.length > 1
            ? (0, react_jsx_runtime.jsxs)('div', { className: s.indicatorPool,
              children: keys.map((entry) => {
                const active = entry.current === true;
                const name = entry.name !== '' ? entry.name : entry.ref;
                return (0, react_jsx_runtime.jsxs)('div', {
                  className: `${s.indicatorPoolRow}${active ? ` ${s.indicatorPoolRowActive}` : ''}`,
                  key: entry.ref,
                  children: [
                    (0, react_jsx_runtime.jsx)('span', { className: s.indicatorPoolName, children: name }),
                    (0, react_jsx_runtime.jsx)('span', { className: s.indicatorPoolValue,
                      children: entry.weeklyRemainingPercent === undefined
                        ? '—'
                        : `${Math.round(entry.weeklyRemainingPercent)}%`,
                    }),
                  ],
                });
              }),
            })
            : null,
        ],
      });
    }

    /**
     * The session's model directory.
     *
     * `directoryFor` throws when the session resolves no scope or no
     * binding — a session that is tearing down, or one the Host has already
     * dropped. A throw inside a slot's `inject` takes the whole composer
     * down, so the lookup is guarded and the cell simply has no directory.
     * @param directories - the model-directory service.
     * @param sessionId - the owning session.
     * @returns the directory's snapshot store, or undefined.
     */
    function directoryOf(directories, sessionId) {
      try {
        return directories.directoryFor(sessionId).store;
      } catch {
        return undefined;
      }
    }

    /**
     * The compact quota capsule beside the model selector.
     *
     * The provider comes from the session's selected model, so the indicator
     * only appears when the session talks to a provider this plugin pools.
     * The key that is in use and its two windows come from the Host's health
     * route, which never sends a key value to the browser.
     * @param props - the session's model directory, the translator, and the
     *   Host route.
     */
    function PoolUsageIndicator(props) {
      const { directory, t } = props;
      const state = directory === undefined
        ? undefined
        : (0, react.useSyncExternalStore)(
          (listener) => directory.subscribe(listener),
          () => directory.getSnapshot(),
          () => directory.getSnapshot(),
        );
      const current = state?.current ?? null;
      const provider = current?.provider;
      const [usage, setUsage] = (0, react.useState)(null);
      const [error, setError] = (0, react.useState)(undefined);
      const [busy, setBusy] = (0, react.useState)(false);
      // The panel is a hover panel: it shows while the pointer is over the
      // host, and while the trigger holds the focus. The pointer handlers
      // live on the host, so moving onto the panel keeps it open and
      // moving away closes it.
      const [hovered, setHovered] = (0, react.useState)(false);
      const [focused, setFocused] = (0, react.useState)(false);
      const tooltipId = (0, react.useId)();
      const seq = (0, react.useRef)(0);
      // The countdown text is derived from the clock, so a tick re-renders the
      // panel while it is open.
      const [, setTick] = (0, react.useState)(0);

      const load = (0, react.useCallback)((force) => {
        if (provider === undefined) return Promise.resolve();
        const mine = ++seq.current;
        if (force) setBusy(true);
        return fetch(`${HEALTH_URL}?provider=${encodeURIComponent(provider)}${force ? '&refresh=1' : ''}`, {
          headers: { Accept: 'application/json' },
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((body) => {
            if (mine !== seq.current) return;
            setUsage({ keys: Array.isArray(body?.keys) ? body.keys : [] });
            setError(undefined);
          })
          .catch((cause) => {
            if (mine !== seq.current) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            if (mine === seq.current && force) setBusy(false);
          });
      }, [provider]);

      (0, react.useEffect)(() => {
        ++seq.current;
        if (provider === undefined) {
          setUsage(null);
          setError(undefined);
          return undefined;
        }
        void load(false);
        return () => { ++seq.current; };
      }, [provider, load]);

      (0, react.useEffect)(() => {
        if (provider === undefined) return undefined;
        const id = setInterval(() => { void load(false); }, INDICATOR_POLL_MS);
        return () => clearInterval(id);
      }, [provider, load]);

      (0, react.useEffect)(() => {
        if (provider === undefined) return undefined;
        const id = setInterval(() => setTick((value) => value + 1), 30000);
        return () => clearInterval(id);
      }, [provider]);

      // The indicator belongs to a pooled provider only. A session on any
      // other route shows nothing at all.
      const pooled = props.pooledProviders();
      if (!pooled.includes(provider)) return null;

      const keys = usage?.keys ?? [];
      const currentKey = keys.find((entry) => entry.current === true);
      const loading = usage === null;
      const intervalPercent = currentKey?.intervalRemainingPercent;
      const weeklyPercent = currentKey?.weeklyRemainingPercent;
      const keyName = currentKey === undefined
        ? t('indicatorNoActiveKey')
        : (currentKey.name !== '' ? currentKey.name : currentKey.ref);
      const percentText = (value) => (typeof value === 'number' && Number.isFinite(value)
        ? `${Math.round(value)}%`
        : '—');
      const summary = loading
        ? t('indicatorLoading')
        : error !== undefined
          ? t('indicatorError', { message: error })
          : t('indicatorSummary', {
            key: keyName,
            interval: percentText(intervalPercent),
            weekly: percentText(weeklyPercent),
          });
      const showPanel = hovered || focused;

      // The panel is an absolutely positioned child of the inline host, so
      // the host's own box places it: no portal, no measurement.
      const panel = showPanel
        ? (0, react_jsx_runtime.jsx)(IndicatorPanel, {
          id: tooltipId,
          keys,
          loading,
          error: error === undefined ? undefined : t('indicatorError', { message: error }),
          provider,
          t,
        })
        : null;

      // The trigger is an ordinary inline element in the composer row. The
      // panel is absolutely positioned inside the host, which is its
      // containing block, so nothing has to be portaled or measured.
      const trigger = (0, react_jsx_runtime.jsx)('button', {
        type: 'button',
        className: s.indicatorTrigger,
        'aria-label': summary,
        'aria-busy': busy ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        'aria-expanded': showPanel,
        'aria-describedby': showPanel ? tooltipId : undefined,
        title: summary,
        onClick: () => { void load(true); },
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => {
          if (event.key === 'Escape') {
            setHovered(false);
            setFocused(false);
            event.stopPropagation();
          }
        },
        children: (0, react_jsx_runtime.jsxs)('span', { className: s.indicatorRows,
          children: [
            (0, react_jsx_runtime.jsx)(IndicatorBar, {
              label: '5h',
              percent: intervalPercent,
              loading,
            }),
            (0, react_jsx_runtime.jsx)(IndicatorBar, {
              label: '7d',
              percent: weeklyPercent,
              loading,
            }),
          ],
        }),
      });

      // The host carries the data attributes, keeps the slot occupied, is
      // the containing block of the panel, and owns the pointer handlers
      // that open and close it.
      return (0, react_jsx_runtime.jsxs)('span', {
        className: s.indicatorHost,
        'data-multi-key-rotation': 'true',
        'data-multi-key-rotation-provider': provider,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        children: [trigger, panel],
      });
    }
    //#endregion
    //#region src/client/controller.js
    let keyIdCounter = 0;

    /** A fresh local id for one staged key row. */
    function newKeyId() {
      return `key-${++keyIdCounter}`;
    }

    /**
     * The page's state and its commands.
     *
     * The controller owns everything the page reads: the provider directory,
     * the saved pool configuration, the staged edits, and each key's reported
     * usage. The component reads one snapshot and calls the commands; it never
     * touches the Host directly.
     */
    var KeyPoolController = class {
      form;
      remote;
      store;
      rows = new Map();
      usage = new Map();
      /**
       * The keys the user has typed but not saved, keyed by their pool
       * reference. The value lives here, not in the rebuilt rows, so the
       * Host's echo of an unrelated write cannot discard it.
       */
      staged = new Map();
      loading = true;
      saving = false;
      /** A reload the Host's echo asked for while a save was running. */
      reloadPending = false;
      /** How long one settings write may take before the page gives up on it. */
      writeTimeoutMs = WRITE_TIMEOUT_MS;
      refreshing = new Set();
      error = null;
      notice = null;

      /**
       * @param form - the config form for the `llm-key-pool` namespace.
       * @param remote - the typed wire remote client.
       */
      constructor(form, remote) {
        this.form = form;
        this.remote = remote;
        this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(this.initialState());
        try {
          this.form.subscribe(() => {
            void this.load();
          });
        } catch {
          // A form that cannot be subscribed to still works once; the page
          // simply does not follow later edits of the section.
        }
        void this.load();
      }

      /** The empty state of the page. */
      initialState() {
        return {
          loading: true,
          saving: false,
          refreshing: [],
          error: null,
          notice: null,
          dirty: false,
          providers: [],
        };
      }

      /**
       * The current value of the settings section, or an empty object when
       * the form cannot be read. The page must never render from a throw.
       * @returns the section value.
       */
      readSection() {
        try {
          const snapshot = this.form.getSnapshot();
          const value = snapshot?.value;
          return typeof value === 'object' && value !== null ? value : {};
        } catch {
          return {};
        }
      }

      /**
       * The provider routes this plugin pools.
       *
       * The composer indicator uses this to decide whether the session's
       * provider is one the pool owns: a session on any other route shows no
       * indicator at all. The list comes from the saved configuration, so it
       * is right before the first load settles, and it is recomputed on every
       * call so a pool that is switched on later is picked up.
       * @returns the pooled provider route ids.
       */
      pooledProviders() {
        const out = [];
        for (const [provider, profile] of this.readProfiles(this.readSection())) {
          if (profile.enabled !== true) continue;
          if (profile.keys.length === 0) continue;
          out.push(provider);
        }
        return out;
      }

      /** Whether the Host accepts writes for this namespace. */
      writable() {
        try {
          return this.form.getSnapshot()?.writable === true;
        } catch {
          return false;
        }
      }

      /** Load the registered providers and their saved pool configuration. */
      async load() {
        // The Host folds a settings write back through the mirror, and the
        // mirror's subscribers run this. A reload that lands while a save is
        // running would rebuild the rows under the save's feet and discard
        // the staged values it is still writing, so the reload waits for the
        // save to finish.
        if (this.saving) {
          this.reloadPending = true;
          return;
        }
        try {
          const [registeredResponse, declaredResponse] = await Promise.all([
            this.remote.llm.listProviders(),
            this.remote.llm.listConfigurableProviders(),
          ]);
          if (!registeredResponse.ok) throw new Error(registeredResponse.error.message);
          if (!declaredResponse.ok) throw new Error(declaredResponse.error.message);
          const saved = this.readProfiles(this.readSection());
          const declared = new Map(declaredResponse.value.map((entry) => [entry.provider, entry]));
          this.rows.clear();
          for (const entry of registeredResponse.value) {
            this.rows.set(entry.id, this.buildRow(entry, declared.get(entry.id), saved.get(entry.id)));
          }
          await this.refreshCredentialState();
          this.loading = false;
          this.error = null;
          this.publish();
          for (const provider of this.rows.keys()) void this.refreshUsage(provider, false);
        } catch (error) {
          this.loading = false;
          this.error = error instanceof Error ? error.message : String(error);
          this.publish();
        }
      }

      /** Read saved profiles from the settings section value. */
      readProfiles(value) {
        const out = new Map();
        const providers = value?.['providers'];
        if (providers === undefined || typeof providers !== 'object' || providers === null) return out;
        for (const [provider, raw] of Object.entries(providers)) {
          if (typeof raw !== 'object' || raw === null) continue;
          const p = raw;
          const keys = Array.isArray(p['keys']) ? p['keys'] : [];
          const policy = typeof p['policy'] === 'object' && p['policy'] !== null ? p['policy'] : {};
          out.set(provider, {
            enabled: p['enabled'] === true,
            rotateOn: Array.isArray(p['rotate_on']) && p['rotate_on'].length > 0 ? p['rotate_on'] : [...DEFAULT_ROTATE_ON],
            pinnedRef: typeof p['pinned_ref'] === 'string' ? p['pinned_ref'] : '',
            keys: keys
              .filter((entry) => typeof entry === 'object' && entry !== null)
              .map((entry) => ({
                name: typeof entry['name'] === 'string' ? entry['name'] : '',
                ref: typeof entry['ref'] === 'string' ? entry['ref'] : '',
                enabled: entry['enabled'] !== false,
              }))
              .filter((entry) => entry.ref !== ''),
            policy: {
              mode: policy['mode'] === 'remaining' ? 'remaining' : 'failure',
              thresholdPercent: typeof policy['thresholdPercent'] === 'number' ? clampPercent(policy['thresholdPercent']) : 0,
              reservePercent: typeof policy['reservePercent'] === 'number' ? clampPercent(policy['reservePercent']) : 0,
            },
          });
        }
        return out;
      }

      /**
       * Build a provider row from its registered entry, declared directory, and
       * saved profile.
       */
      buildRow(entry, declared, saved) {
        const chain = (saved?.keys ?? []).map((key) => {
          const pending = this.staged.get(key.ref);
          return {
            id: newKeyId(),
            slot: slotOfPoolRef(key.ref) ?? 0,
            name: pending?.name ?? key.name,
            ref: key.ref,
            enabled: key.enabled,
            value: pending?.value ?? '',
            staged: pending !== undefined,
            configured: false,
            inProfile: true,
            masked: '',
          };
        });
        chain.sort((a, b) => a.slot - b.slot);
        // A staged key the saved profile does not name yet still belongs to
        // the pool; it is carried over so the user's paste survives.
        for (const [ref, pending] of this.staged) {
          if (chain.some((key) => key.ref === ref)) continue;
          if (pending.provider !== entry.id) continue;
          const slot = slotOfPoolRef(ref) ?? (chain.length + 1);
          chain.push({
            id: newKeyId(),
            slot,
            name: pending.name,
            ref,
            enabled: true,
            value: pending.value,
            staged: true,
            configured: false,
            inProfile: false,
            masked: '',
          });
        }
        chain.sort((a, b) => a.slot - b.slot);
        return {
          provider: entry.id,
          displayName: declared?.displayName ?? entry.name,
          envRef: envRefOf(entry.id),
          enabled: saved?.enabled ?? false,
          rotateOn: saved?.rotateOn ?? [...DEFAULT_ROTATE_ON],
          // The key the user pinned as the one to use. It is a reference, so
          // it survives a rename and a value change.
          pinnedRef: saved?.pinnedRef ?? '',
          policy: saved?.policy ?? { ...DEFAULT_POLICY },
          chain,
        };
      }

      /** Update per-reference saved flags (which pool slots hold a value) from describe. */
      async refreshCredentialState() {
        const refs = new Set();
        for (const row of this.rows.values()) for (const key of row.chain) refs.add(key.ref);
        if (refs.size === 0) return;
        try {
          const response = await this.remote.credentials.describe([...refs]);
          if (!response.ok) return;
          const views = response.value;
          for (const row of this.rows.values()) {
            for (const key of row.chain) {
              const info = views[key.ref];
              key.configured = info?.configured === true;
              key.masked = typeof info?.masked === 'string' ? info.masked : '';
              // A key whose credential write landed is no longer staged.
              if (key.configured && key.value.trim() !== '') {
                key.staged = false;
                key.value = '';
                this.staged.delete(key.ref);
              }
            }
          }
        } catch {
          // Credential state is an enrichment: a failure leaves the rows
          // without a stored badge instead of failing the whole page.
        }
      }

      /** The next never-used pool slot: the largest slot number in use plus one. */
      nextSlot(row) {
        let max = 0;
        for (const key of row.chain) if (key.slot > max) max = key.slot;
        return max + 1;
      }

      /**
       * Read the usage of one provider's keys from the Host.
       *
       * The Host owns the key values, so the browser asks the Host for the
       * remaining share and the reset moment — it never sees a key.
       * @param provider - provider route id.
       * @param force - ask the Host for a fresh probe.
       */
      async refreshUsage(provider, force) {
        if (this.refreshing.has(provider)) return;
        this.refreshing.add(provider);
        this.publish();
        try {
          const url = `${HEALTH_URL}?provider=${encodeURIComponent(provider)}${force ? '&refresh=1' : ''}`;
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          this.usage.set(provider, Array.isArray(body?.keys) ? body.keys : []);
        } catch {
          // The usage panel degrades to "unavailable"; the page keeps working.
          if (!this.usage.has(provider)) this.usage.set(provider, []);
        } finally {
          this.refreshing.delete(provider);
          this.publish();
        }
      }

      /** Publish the current state to the page. */
      publish() {
        this.store.set({
          loading: this.loading,
          saving: this.saving,
          refreshing: [...this.refreshing],
          error: this.error,
          notice: this.notice,
          dirty: this.isDirty(),
          providers: [...this.rows.values()].map((row) => ({
            ...row,
            usage: this.usage.get(row.provider) ?? [],
          })),
        });
      }

      /** Whether any provider holds edits that are not saved yet. */
      isDirty() {
        for (const row of this.rows.values()) {
          // A key whose value is typed but not yet written to the credential
          // store is an edit in its own right.
          if (row.chain.some((key) => key.value.trim() !== '')) return true;
          const saved = this.readProfiles(this.readSection()).get(row.provider);
          if (saved === undefined) {
            // A provider with no saved profile is not dirty until something
            // about it actually differs: on a fresh install every provider
            // would otherwise report an unsaved change.
            if (row.enabled) return true;
            if (row.chain.length > 0) return true;
            continue;
          }
          if (saved.enabled !== row.enabled) return true;
          if (saved.pinnedRef !== row.pinnedRef) return true;
          if (saved.policy.mode !== row.policy.mode) return true;
          if (saved.policy.thresholdPercent !== row.policy.thresholdPercent) return true;
          if (saved.policy.reservePercent !== row.policy.reservePercent) return true;
          if (saved.rotateOn.length !== row.rotateOn.length) return true;
          if (saved.rotateOn.some((code) => !row.rotateOn.includes(code))) return true;
          if (saved.keys.length !== row.chain.length) return true;
          const savedRefs = saved.keys.map((key) => key.ref).sort();
          const rowRefs = row.chain.map((key) => key.ref).sort();
          if (savedRefs.some((ref, index) => ref !== rowRefs[index])) return true;
          for (const key of row.chain) {
            const match = saved.keys.find((entry) => entry.ref === key.ref);
            if (match === undefined) continue;
            if (match.name !== key.name) return true;
            if (match.enabled !== key.enabled) return true;
          }
        }
        return false;
      }

      /**
       * Remember one key's staged name and value.
       *
       * The staged map is what survives a reload of the rows: the Host's
       * write of an unrelated field folds back through the settings mirror
       * and rebuilds the rows, which would otherwise throw the user's paste
       * away.
       * @param provider - the provider the key belongs to.
       * @param key - the key row.
       */
      rememberStaged(provider, key) {
        if (key.value.trim() === '') {
          this.staged.delete(key.ref);
          return;
        }
        this.staged.set(key.ref, { provider, name: key.name, value: key.value });
      }

      /**
       * The profile of one provider, as the settings section stores it.
       *
       * A key whose value is still only in the page is NOT written into the
       * profile: the profile names slots, and a slot the credential store
       * does not hold would be a name for nothing. The key joins the profile
       * when its credential write succeeds.
       * @param provider - the provider route id.
       * @returns the profile object, or undefined when the provider is gone.
       */
      profileOf(provider) {
        const row = this.rows.get(provider);
        if (row === undefined) return undefined;
        const keys = row.chain
          .filter((key) => key.configured || key.inProfile === true)
          .map((key) => ({ name: key.name, ref: key.ref, enabled: key.enabled }));
        return {
          enabled: row.enabled,
          rotate_on: row.rotateOn,
          keys,
          pinned_ref: row.pinnedRef,
          policy: row.policy,
        };
      }

      /**
       * Persist one provider's profile to the settings section.
       *
       * The write addresses ONE provider path, never the whole `providers`
       * dict. Writing the whole dict made every save rewrite every provider,
       * which meant one profile write per provider, each one restarting the
       * plugin and moving the settings revision out from under the next
       * write - a conflict the Host answers by refusing the write, which left
       * the page waiting on a save that would never land.
       * @param provider - the provider route id.
       * @returns whether the Host accepted the write.
       */
      async commitProvider(provider) {
        const profile = this.profileOf(provider);
        if (profile === undefined) return true;
        return this.writeProfiles([[provider, profile]]);
      }

      /**
       * Persist several providers' profiles in ONE settings write.
       *
       * One write means one profile rewrite, one plugin restart, and one
       * revision bump - instead of one per provider.
       * @param entries - the `[provider, profile]` pairs to write.
       * @returns whether the Host accepted the write.
       */
      async writeProfiles(entries) {
        if (entries.length === 0) return true;
        const ops = entries.map(([provider, profile]) => ({
          op: 'set',
          path: ['providers', provider],
          value: profile,
        }));
        try {
          const ok = await this.withTimeout(this.form.mutate(ops), this.writeTimeoutMs);
          if (!ok) {
            this.notice = 'savedFail';
            this.publish();
            return false;
          }
        } catch (error) {
          this.notice = 'savedFail';
          this.error = error instanceof Error ? error.message : String(error);
          this.publish();
          return false;
        }
        return true;
      }

      /**
       * Await a promise, giving up after a deadline.
       *
       * A settings write crosses the wire, and the Host restarts the plugin
       * while answering it. If that answer never arrives, the page must not
       * wait forever: the user would stare at a permanent "Saving". The
       * write is abandoned, the failure is reported, and the button returns
       * to its normal state.
       * @param promise - the pending promise.
       * @param ms - the deadline in milliseconds.
       * @returns the promise value, or false when the deadline passed.
       */
      async withTimeout(promise, ms) {
        let timer;
        const deadline = new Promise((resolve) => {
          timer = setTimeout(() => resolve(TIMEOUT), ms);
        });
        try {
          const result = await Promise.race([promise, deadline]);
          if (result === TIMEOUT) return false;
          return result;
        } finally {
          clearTimeout(timer);
        }
      }

      /**
       * Save every staged key and every provider's profile.
       *
       * The key values go to the credential store first, because the pool
       * profile names the slots; a key that could not be written keeps its
       * value in the page so the user can try again.
       */
      async save() {
        if (this.saving) return;
        this.saving = true;
        this.error = null;
        this.notice = null;
        this.publish();
        // The two failures are told apart: a key the credential store refused
        // is a different problem from a profile the Host refused.
        let keyFailed = false;
        let profileFailed = false;
        try {
          // The key values go to the credential store first, because the pool
          // profile names the slots; a key that could not be written keeps its
          // value in the page so the user can try again.
          for (const row of this.rows.values()) {
            const dirty = row.chain.filter((key) => key.value.trim() !== '');
            for (const key of dirty) {
              try {
                const response = await this.remote.credentials.set(key.ref, key.value.trim());
                if (response.ok) {
                  key.configured = true;
                  key.inProfile = true;
                  key.staged = false;
                  key.value = '';
                  this.staged.delete(key.ref);
                } else {
                  keyFailed = true;
                }
              } catch {
                keyFailed = true;
              }
            }
          }
          // ONE settings write for every provider. The write addresses each
          // provider's own path, so it neither rewrites nor drops a provider
          // the page does not know about.
          const entries = [];
          for (const provider of this.rows.keys()) {
            const profile = this.profileOf(provider);
            if (profile !== undefined) entries.push([provider, profile]);
          }
          if (!(await this.writeProfiles(entries))) profileFailed = true;
          await this.refreshCredentialState();
          if (keyFailed) this.notice = 'keySaveFailed';
          else if (profileFailed) this.notice = 'savedFail';
          else this.notice = 'savedOk';
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
          this.notice = 'savedFail';
        } finally {
          // The flag clears on EVERY path, including a throw: a page stuck
          // on "Saving" is the one failure the user cannot work around.
          this.saving = false;
          this.publish();
        }
        // A reload the echo asked for while the save ran now runs.
        if (this.reloadPending) {
          this.reloadPending = false;
          void this.load();
        }
        if (!keyFailed && !profileFailed) {
          for (const row of this.rows.values()) void this.refreshUsage(row.provider, true);
        }
      }

      /** The face the page's slot registration injects. */
      face() {
        return {
          // The slot's `InjectFace` types a `hooks` entry named `keyPool` as
          // the prop `useKeyPool`: the framework prefixes `use` itself, so the
          // key carries no prefix of its own.
          hooks: { keyPool: this.store },
          /** The controller itself, for a caller that needs its knobs. */
          controller: this,
          setEnabled: (provider, enabled) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            row.enabled = enabled;
            this.publish();
            void this.commitProvider(provider);
          },
          toggleRotateOn: (provider, code) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            row.rotateOn = row.rotateOn.includes(code)
              ? row.rotateOn.filter((entry) => entry !== code)
              : [...row.rotateOn, code];
            this.publish();
            void this.commitProvider(provider);
          },
          setPolicyMode: (provider, mode) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            row.policy = { ...row.policy, mode };
            this.publish();
            void this.commitProvider(provider);
          },
          setPolicyNumber: (provider, field, value) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            row.policy = { ...row.policy, [field]: clampPercent(value) };
            this.publish();
            void this.commitProvider(provider);
          },
          renameKey: (provider, keyId, name) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const key = row.chain.find((entry) => entry.id === keyId);
            if (key !== undefined) {
              key.name = name;
              this.rememberStaged(provider, key);
              this.publish();
            }
          },
          editKey: (provider, keyId, value) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const key = row.chain.find((entry) => entry.id === keyId);
            if (key !== undefined) {
              key.value = value;
              key.staged = value.trim() !== '';
              this.rememberStaged(provider, key);
              this.publish();
            }
          },
          pinKey: (provider, keyId) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const key = row.chain.find((entry) => entry.id === keyId);
            if (key === undefined) return;
            // Clicking the pinned key again unpins it: the pool goes back to
            // picking by its own rules.
            row.pinnedRef = row.pinnedRef === key.ref ? '' : key.ref;
            this.publish();
            void this.commitProvider(provider);
          },
          toggleKeyEnabled: (provider, keyId) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const key = row.chain.find((entry) => entry.id === keyId);
            if (key !== undefined) {
              key.enabled = !key.enabled;
              this.publish();
              void this.commitProvider(provider);
            }
          },
          addKey: (provider, name, value) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const slot = this.nextSlot(row);
            const ref = poolRefOf(provider, slot);
            row.chain.push({
              id: newKeyId(),
              slot,
              name: name ?? '',
              ref,
              enabled: true,
              value: value ?? '',
              staged: (value ?? '') !== '',
              configured: false,
              inProfile: false,
              masked: '',
            });
            if ((value ?? '') !== '') {
              this.staged.set(ref, { provider, name: name ?? '', value });
            }
            this.publish();
          },
          removeKey: (provider, keyId) => {
            const row = this.rows.get(provider);
            if (row === undefined) return;
            const key = row.chain.find((entry) => entry.id === keyId);
            if (key === undefined) return;
            row.chain = row.chain.filter((entry) => entry.id !== keyId);
            this.staged.delete(key.ref);
            this.publish();
            void (async () => {
              let ok = true;
              try {
                const response = await this.remote.credentials.unset(key.ref);
                ok = response.ok;
              } catch {
                ok = false;
              }
              this.notice = ok ? 'keyRemoved' : 'keyRemoveFailed';
              this.publish();
            })();
            void this.commitProvider(provider);
          },
          refreshUsage: (provider) => {
            void this.refreshUsage(provider, true);
          },
          save: () => {
            void this.save();
          },
        };
      }
    };
    //#endregion
    //#region src/client/KeyPoolPage.js
    /**
     * Whether a provider holds a pool that is actually usable.
     *
     * A pool is configured when at least one of its slots holds a value in
     * the credential store. A provider whose slots are all empty is not
     * pooling anything, so its card has nothing to show.
     * @param row - the provider row.
     * @returns whether the provider has a configured pool.
     */
    function hasConfiguredPool(row) {
      if (row === undefined || row === null) return false;
      const chain = Array.isArray(row.chain) ? row.chain : [];
      if (chain.length === 0) return false;
      return chain.some((key) => key.configured === true || String(key.value ?? '').trim() !== '');
    }

    /**
     * Order the keys of one pool for the card.
     *
     * The list is in the order the pool would USE the keys: the key whose
     * weekly window rolls over soonest comes first, because that is the key
     * the switching policy spends first. The keys with no weekly quota known
     * keep their slot order and sort after the ones that do — an unknown
     * remaining time is not known to be near.
     *
     * The order is only the DISPLAY order. The pool's own choice is made by
     * the Host, from the same rule, and does not depend on how the card
     * happens to list the keys.
     * @param chain - the provider's keys.
     * @param usageOf - the usage of one key, by reference.
     * @returns the keys, in display order.
     */
    function orderKeysForDisplay(chain, usageOf) {
      const items = chain.map((key, index) => {
        const usage = usageOf(key.ref)
        const weeklyResetAt = usage?.weeklyResetAt
        return {
          key,
          index,
          weeklyResetAt: typeof weeklyResetAt === 'number' ? weeklyResetAt : undefined,
        }
      })
      items.sort((a, b) => {
        if (a.weeklyResetAt === undefined && b.weeklyResetAt === undefined) return a.index - b.index
        if (a.weeklyResetAt === undefined) return 1
        if (b.weeklyResetAt === undefined) return -1
        // The week that rolls over soonest comes first.
        if (a.weeklyResetAt !== b.weeklyResetAt) return a.weeklyResetAt - b.weeklyResetAt
        return a.index - b.index
      })
      return items.map((entry) => entry.key)
    }

    /**
     * The configuration page.
     *
     * The page renders a card per provider, each holding the pool's keys,
     * their reported usage, the switching policy, and the failure triggers.
     * @param props - composed slot props (runtime, locale, inject face).
     */
    function KeyPoolPage(props) {
      const { t, useKeyPool, setEnabled, toggleRotateOn, setPolicyMode, setPolicyNumber, renameKey, editKey, pinKey, toggleKeyEnabled, addKey, removeKey, refreshUsage, save } = props;
      const state = useKeyPool((snapshot) => snapshot);
      // A provider without a configured pool has nothing worth showing: its
      // card would carry an empty key list and a policy that does nothing,
      // so it starts collapsed. The rows only arrive with the first load, so
      // the default is derived on every render and only the user's own
      // toggles are remembered.
      const [overrides, setOverrides] = react.useState(() => new Map());
      const isOpen = (provider, row) => {
        const override = overrides.get(provider);
        if (override !== undefined) return override;
        return hasConfiguredPool(row);
      };

      if (state.loading) {
        return (0, react_jsx_runtime.jsxs)('div', {
          className: s.page,
          children: [
            (0, react_jsx_runtime.jsx)('h3', { className: s.sectionTitle, children: t('title') }),
            (0, react_jsx_runtime.jsx)('p', { className: s.spinner, children: t('loading') }),
          ],
        });
      }

      const toggle = (provider, row) => {
        setOverrides((previous) => {
          const next = new Map(previous);
          next.set(provider, !isOpen(provider, row));
          return next;
        });
      };

      return (0, react_jsx_runtime.jsxs)('div', {
        className: s.page,
        children: [
          (0, react_jsx_runtime.jsxs)('div', {
            className: s.section,
            children: [
              (0, react_jsx_runtime.jsx)('h4', { className: s.sectionTitle, children: t('title') }),
              (0, react_jsx_runtime.jsx)('p', { className: s.intro, children: t('description') }),
            ],
          }),
          state.error !== null
            ? (0, react_jsx_runtime.jsx)('div', { className: `${s.banner} ${s.bannerError}`, role: 'alert', children: state.error })
            : null,
          state.error === null && state.providers.length === 0
            ? (0, react_jsx_runtime.jsx)('div', { className: `${s.banner} ${s.bannerWarn}`, children: t('emptyProviders') })
            : (0, react_jsx_runtime.jsx)('div', {
                className: s.section,
                children: state.providers.map((row) => (0, react_jsx_runtime.jsx)(ProviderCard, {
                  row,
                  open: isOpen(row.provider, row),
                  refreshing: state.refreshing.includes(row.provider),
                  onToggle: () => toggle(row.provider, row),
                  onSetEnabled: (enabled) => setEnabled(row.provider, enabled),
                  onToggleRotateOn: (code) => toggleRotateOn(row.provider, code),
                  onSetPolicyMode: (mode) => setPolicyMode(row.provider, mode),
                  onSetPolicyNumber: (field, value) => setPolicyNumber(row.provider, field, value),
                  onRenameKey: (keyId, name) => renameKey(row.provider, keyId, name),
                  onEditKey: (keyId, value) => editKey(row.provider, keyId, value),
                  onPinKey: (keyId) => pinKey(row.provider, keyId),
                  onToggleKeyEnabled: (keyId) => toggleKeyEnabled(row.provider, keyId),
                  onAddKey: (name, value) => addKey(row.provider, name, value),
                  onRemoveKey: (keyId) => removeKey(row.provider, keyId),
                  onRefreshUsage: () => refreshUsage(row.provider),
                  t,
                }, row.provider)),
              }),
          (0, react_jsx_runtime.jsxs)('div', {
            className: s.footer,
            children: [
              (0, react_jsx_runtime.jsx)('button', {
                type: 'button',
                className: `${s.btn} ${s.btnPrimary}`,
                onClick: save,
                disabled: state.saving || !state.dirty,
                children: state.saving ? t('saving') : t('save'),
              }),
              (0, react_jsx_runtime.jsx)('span', {
                className: state.error !== null ? `${s.footerNote} ${s.statusError}` : s.footerNote,
                role: 'status',
                children: state.notice !== null ? t(state.notice) : state.dirty ? t('unsaved') : t('allSaved'),
              }),
            ],
          }),
        ],
      });
    }

    /**
     * One provider's card: its switch, its keys, its policy, and its triggers.
     * @param props - the provider row, its callbacks, and the translator.
     */
    function ProviderCard(props) {
      const {
        row, open, refreshing, onToggle, onSetEnabled, onToggleRotateOn, onSetPolicyMode, onSetPolicyNumber,
        onRenameKey, onEditKey, onPinKey, onToggleKeyEnabled, onAddKey, onRemoveKey, onRefreshUsage, t,
      } = props;
      const [draftName, setDraftName] = react.useState('');
      const [draftValue, setDraftValue] = react.useState('');
      const [bulk, setBulk] = react.useState('');
      const bodyId = `m_pool_body_${row.provider}`;
      const [showBulk, setShowBulk] = react.useState(false);
      const [replacing, setReplacing] = react.useState(undefined);

      const usageOf = (ref) => row.usage?.find((entry) => entry.ref === ref);
      const staged = row.chain.filter((key) => key.value.trim() !== '').length;

      const submitDraft = () => {
        const name = draftName.trim();
        const value = draftValue.trim();
        if (value === '') return;
        onAddKey(name, value);
        setDraftName('');
        setDraftValue('');
      };

      const submitBulk = () => {
        const values = bulk.split(/[\n\r]+/).map((line) => line.trim()).filter((line) => line !== '');
        if (values.length === 0) return;
        for (const value of values) onAddKey('', value);
        setBulk('');
        setShowBulk(false);
      };

      return (0, react_jsx_runtime.jsxs)('div', {
        className: s.card,
        children: [
          (0, react_jsx_runtime.jsxs)('div', {
            className: s.cardHead,
            children: [
              (0, react_jsx_runtime.jsx)('button', {
                type: 'button',
                className: s.switch,
                role: 'switch',
                'aria-checked': row.enabled,
                'aria-label': `${row.displayName}: ${t('rotationLabel')}`,
                onClick: (event) => {
                  event.stopPropagation();
                  onSetEnabled(!row.enabled);
                },
                children: (0, react_jsx_runtime.jsx)('span', { className: s.switchThumb }),
              }),
              (0, react_jsx_runtime.jsx)('button', {
                type: 'button',
                className: s.cardHeadText,
                onClick: onToggle,
                'aria-expanded': open,
                'aria-controls': bodyId,
                children: (0, react_jsx_runtime.jsxs)('span', {
                  className: s.cardHeadText,
                  children: [
                    (0, react_jsx_runtime.jsx)('span', { className: s.providerName, children: row.displayName }),
                    (0, react_jsx_runtime.jsx)('span', { className: s.providerId, children: row.provider }),
                  ],
                }),
              }),
              (0, react_jsx_runtime.jsx)('span', {
                className: open ? `${s.chevron} ${s.chevronOpen}` : s.chevron,
                'aria-hidden': true,
                children: '\u25be',
              }),
              (0, react_jsx_runtime.jsx)('span', {
                className: s.tag,
                children: row.chain.length === 1 ? t('keyCountOne') : t('keyCount', { count: row.chain.length }),
              }),
              (0, react_jsx_runtime.jsx)('span', {
                className: row.enabled ? `${s.tag} ${s.tagSuccess}` : s.tag,
                children: row.enabled ? t('enabled') : t('disabled'),
              }),
            ],
          }),
          open
            ? (0, react_jsx_runtime.jsxs)('div', {
                className: s.cardBody,
                id: bodyId,
                children: [
                  (0, react_jsx_runtime.jsxs)('div', {
                    className: s.section,
                    children: [
                      (0, react_jsx_runtime.jsxs)('div', {
                        className: s.sectionHead,
                        children: [
                          (0, react_jsx_runtime.jsx)('span', { className: s.sectionTitle, children: t('keys') }),
                          (0, react_jsx_runtime.jsx)('button', {
                            type: 'button',
                            className: `${s.btn} ${s.btnSm}`,
                            onClick: onRefreshUsage,
                            disabled: refreshing,
                            children: refreshing ? t('refreshing') : t('refresh'),
                          }),
                        ],
                      }),
                      (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('keysHint') }),
                      row.chain.length === 0
                        ? (0, react_jsx_runtime.jsx)('div', { className: s.empty, children: t('noKeys') })
                        : (0, react_jsx_runtime.jsx)('div', {
                            className: s.keyList,
                            children: orderKeysForDisplay(row.chain, usageOf).map((key) => (0, react_jsx_runtime.jsx)(KeyRow, {
                              entry: key,
                              usage: usageOf(key.ref),
                              replacing: replacing === key.id,
                              pinned: row.pinnedRef === key.ref,
                              onPin: () => onPinKey(key.id),
                              onToggleReplace: () => setReplacing(replacing === key.id ? undefined : key.id),
                              onRename: (name) => onRenameKey(key.id, name),
                              onEdit: (value) => onEditKey(key.id, value),
                              onToggleEnabled: () => onToggleKeyEnabled(key.id),
                              onRemove: () => onRemoveKey(key.id),
                              t,
                            }, key.id)),
                          }),
                      (0, react_jsx_runtime.jsx)('div', {
                        className: s.addRow,
                        children: [
                          (0, react_jsx_runtime.jsx)('input', {
                            className: `${s.input} ${s.nameInput}`,
                            type: 'text',
                            value: draftName,
                            placeholder: t('keyNamePlaceholder'),
                            'aria-label': t('keyNamePlaceholder'),
                            onChange: (event) => setDraftName(event.target.value),
                          }),
                          (0, react_jsx_runtime.jsx)('input', {
                            className: `${s.input} ${s.keyInput}`,
                            type: 'password',
                            value: draftValue,
                            placeholder: t('keyValuePlaceholder'),
                            'aria-label': t('keyValuePlaceholder'),
                            autoComplete: 'new-password',
                            spellCheck: false,
                            onChange: (event) => setDraftValue(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                submitDraft();
                              }
                            },
                          }),
                          (0, react_jsx_runtime.jsx)('button', {
                            type: 'button',
                            className: `${s.btn} ${s.btnPrimary}`,
                            onClick: submitDraft,
                            disabled: draftValue.trim() === '',
                            children: t('addKey'),
                          }),
                          (0, react_jsx_runtime.jsx)('button', {
                            type: 'button',
                            className: `${s.btn} ${s.btnSm}`,
                            onClick: () => setShowBulk(!showBulk),
                            'aria-expanded': showBulk,
                            children: t('bulkAdd'),
                          }),
                        ],
                      }),
                      showBulk
                        ? (0, react_jsx_runtime.jsxs)('div', {
                            className: s.section,
                            children: [
                              (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('bulkAddHint') }),
                              (0, react_jsx_runtime.jsx)('textarea', {
                                className: s.textarea,
                                value: bulk,
                                placeholder: t('bulkPlaceholder'),
                                spellCheck: false,
                                onChange: (event) => setBulk(event.target.value),
                              }),
                              (0, react_jsx_runtime.jsx)('div', {
                                className: s.addRow,
                                children: (0, react_jsx_runtime.jsx)('button', {
                                  type: 'button',
                                  className: `${s.btn} ${s.btnPrimary}`,
                                  onClick: submitBulk,
                                  disabled: bulk.trim() === '',
                                  children: t('bulkAddButton'),
                                }),
                              }),
                            ],
                          })
                        : null,
                    ],
                  }),
                  (0, react_jsx_runtime.jsxs)('div', {
                    className: s.section,
                    children: [
                      (0, react_jsx_runtime.jsx)('span', { className: s.sectionTitle, children: t('policy') }),
                      (0, react_jsx_runtime.jsxs)('div', {
                        className: s.choiceGroup,
                        role: 'radiogroup',
                        'aria-label': t('policy'),
                        children: [
                          { mode: 'failure', labelKey: 'policyFailure', hintKey: 'policyFailureHint' },
                          { mode: 'remaining', labelKey: 'policyRemaining', hintKey: 'policyRemainingHint' },
                        ].map(({ mode, labelKey, hintKey }) => (0, react_jsx_runtime.jsx)('label', {
                          className: s.choiceRow,
                          key: mode,
                          children: (0, react_jsx_runtime.jsxs)('span', {
                            className: s.choice,
                            children: [
                              (0, react_jsx_runtime.jsx)('input', {
                                type: 'radio',
                                name: `m_pool_policy_${row.provider}`,
                                checked: row.policy.mode === mode,
                                'aria-describedby': `m_pool_hint_${row.provider}_${mode}`,
                                onChange: () => onSetPolicyMode(mode),
                              }),
                              (0, react_jsx_runtime.jsxs)('span', {
                                className: s.choiceText,
                                children: [
                                  (0, react_jsx_runtime.jsx)('span', { className: s.choiceLabel, children: t(labelKey) }),
                                  (0, react_jsx_runtime.jsxs)('span', {
                                    id: `m_pool_hint_${row.provider}_${mode}`,
                                    className: s.choiceHint,
                                    children: t(hintKey),
                                  }),
                                ],
                              }),
                            ],
                          }),
                        })),
                      }),
                      row.policy.mode === 'remaining'
                        ? (0, react_jsx_runtime.jsxs)('div', {
                            className: s.section,
                            children: [
                              (0, react_jsx_runtime.jsxs)('div', {
                                className: s.numberRow,
                                children: [
                                  (0, react_jsx_runtime.jsx)('span', { className: s.choiceLabel, children: t('threshold') }),
                                  (0, react_jsx_runtime.jsx)('input', {
                                    className: s.numberInput,
                                    type: 'number',
                                    min: 0,
                                    max: 100,
                                    value: row.policy.thresholdPercent,
                                    'aria-label': t('threshold'),
                                    onChange: (event) => onSetPolicyNumber('thresholdPercent', Number(event.target.value)),
                                  }),
                                  (0, react_jsx_runtime.jsx)('span', { className: s.choiceLabel, children: t('percent') }),
                                ],
                              }),
                              (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('thresholdHint') }),
                              (0, react_jsx_runtime.jsxs)('div', {
                                className: s.numberRow,
                                children: [
                                  (0, react_jsx_runtime.jsx)('span', { className: s.choiceLabel, children: t('reserve') }),
                                  (0, react_jsx_runtime.jsx)('input', {
                                    className: s.numberInput,
                                    type: 'number',
                                    min: 0,
                                    max: 100,
                                    value: row.policy.reservePercent,
                                    'aria-label': t('reserve'),
                                    onChange: (event) => onSetPolicyNumber('reservePercent', Number(event.target.value)),
                                  }),
                                  (0, react_jsx_runtime.jsx)('span', { className: s.choiceLabel, children: t('percent') }),
                                ],
                              }),
                              (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('reserveHint') }),
                            ],
                          })
                        : null,
                    ],
                  }),
                  (0, react_jsx_runtime.jsxs)('div', {
                    className: s.section,
                    children: [
                      (0, react_jsx_runtime.jsx)('span', { className: s.sectionTitle, children: t('triggers') }),
                      (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('triggersHint') }),
                      (0, react_jsx_runtime.jsxs)('div', {
                        className: s.chips,
                        children: ROTATE_ON.map(({ code, labelKey }) => (0, react_jsx_runtime.jsx)('button', {
                          type: 'button',
                          className: row.rotateOn.includes(code) ? `${s.chip} ${s.chipOn}` : s.chip,
                          'aria-pressed': row.rotateOn.includes(code),
                          key: code,
                          onClick: () => onToggleRotateOn(code),
                          children: t(labelKey),
                        })),
                      }),
                    ],
                  }),
                ],
              })
            : null,
        ],
      });
    }

    /**
     * One key in the pool: its name, its state, and its reported usage.
     *
     * The replace field keeps its value here, in the row, rather than in the
     * controller: a secret the user is typing should not republish the whole
     * page on every keystroke.
     * @param props - the key entry, its usage, and its callbacks.
     */
    function KeyRow(props) {
      const { entry, usage, replacing, pinned, onToggleReplace, onRename, onEdit, onPin, onToggleEnabled, onRemove, t } = props;
      const [replacement, setReplacement] = react.useState('');
      // The Host answers with BOTH windows: the 5-hour window and the
      // weekly one. The older answer carried only the weaker of the two,
      // which made a key with a full week but no 5-hour headroom look the
      // same as a key with neither.
      const remaining = typeof usage?.remainingPercent === 'number' ? usage.remainingPercent : undefined;
      const intervalPercent = typeof usage?.intervalRemainingPercent === 'number'
        ? usage.intervalRemainingPercent
        : undefined;
      const weeklyPercent = typeof usage?.weeklyRemainingPercent === 'number'
        ? usage.weeklyRemainingPercent
        : undefined;
      const intervalResetAt = usage?.intervalResetAt;
      const weeklyResetAt = usage?.weeklyResetAt;
      const quotaFailed = usage !== undefined && usage.quotaOk === false;
      // The Host answers with a plaintext head and tail of the stored key,
      // which is what tells two keys of the same provider apart. The
      // credential service's own mask is the fallback.
      const preview = typeof usage?.preview === 'string' && usage.preview !== ''
        ? usage.preview
        : undefined;

      // The bar's colour follows the window: red when the window is spent,
      // amber when it is nearly spent, green otherwise.
      const fillOf = (percent) => {
        if (percent === undefined) return '';
        if (percent <= 0) return `${s.quotaFill} ${s.quotaFillEmpty}`;
        if (percent < 20) return `${s.quotaFill} ${s.quotaFillLow}`;
        return s.quotaFill;
      };
      const fillClass = fillOf(remaining);
      // The countdown of one window, or undefined when the window does not
      // report a reset moment.
      const resetInOf = (moment) => {
        if (typeof moment !== 'number') return undefined;
        const left = moment - Date.now();
        return left > 0 ? left : undefined;
      };
      const intervalResetIn = resetInOf(intervalResetAt);
      const weeklyResetIn = resetInOf(weeklyResetAt);

      const name = entry.name.trim() === '' ? t('unnamedKey') : entry.name;

      const commitReplacement = () => {
        const value = replacement.trim();
        if (value === '') return;
        onEdit(value);
        setReplacement('');
        onToggleReplace();
      };

      return (0, react_jsx_runtime.jsxs)('div', {
        className: s.keyItem,
        children: [
          (0, react_jsx_runtime.jsxs)('div', {
            className: s.keyRow,
            children: [
              (0, react_jsx_runtime.jsxs)('div', {
                className: s.keyTop,
                children: [
                  (0, react_jsx_runtime.jsx)('input', {
                    className: entry.enabled ? s.keyName : `${s.keyName} ${s.keyNameParked}`,
                    type: 'text',
                    value: entry.name,
                    placeholder: t('unnamedKey'),
                    'aria-label': t('keyNamePlaceholder'),
                    onChange: (event) => onRename(event.target.value),
                  }),
                  (0, react_jsx_runtime.jsxs)('span', {
                    className: s.keyState,
                    children: [
                      entry.value.trim() !== ''
                        ? (0, react_jsx_runtime.jsx)('span', { className: `${s.tag} ${s.tagWarn}`, children: t('staged') })
                        : entry.configured
                          ? (0, react_jsx_runtime.jsx)('span', { className: `${s.tag} ${s.tagSuccess}`, children: t('saved') })
                          : entry.inProfile
                            ? (0, react_jsx_runtime.jsx)('span', { className: `${s.tag} ${s.tagWarn}`, children: t('emptySlot') })
                            : (0, react_jsx_runtime.jsx)('span', { className: s.tag, children: t('notConfigured') }),
                      preview !== undefined
                        ? (0, react_jsx_runtime.jsx)('span', { className: s.keyMask, children: preview })
                        : entry.masked !== ''
                          ? (0, react_jsx_runtime.jsx)('span', { className: s.keyMask, children: entry.masked })
                          : null,
                      !entry.enabled ? (0, react_jsx_runtime.jsx)('span', { className: s.tag, children: t('parked') }) : null,
                    ],
                  }),
                  (0, react_jsx_runtime.jsxs)('span', {
                    className: s.keyActions,
                    children: [
                      pinned
                        ? (0, react_jsx_runtime.jsx)('span', {
                          className: s.keyPinned,
                          title: t('pinnedHint'),
                          children: t('inUse'),
                        })
                        : (0, react_jsx_runtime.jsx)('button', {
                          type: 'button',
                          className: s.keyPinBtn,
                          title: t('useThisKey'),
                          'aria-label': t('useThisKey'),
                          onClick: onPin,
                          children: '★',
                        }),
                      (0, react_jsx_runtime.jsx)('button', {
                        type: 'button',
                        className: s.iconBtn,
                        title: entry.enabled ? t('park') : t('unpark'),
                        'aria-label': entry.enabled ? t('park') : t('unpark'),
                        onClick: onToggleEnabled,
                        children: entry.enabled ? '⏸' : '▶',
                      }),
                      (0, react_jsx_runtime.jsx)('button', {
                        type: 'button',
                        className: s.iconBtn,
                        title: t('replace'),
                        'aria-label': t('replace'),
                        onClick: onToggleReplace,
                        children: '⟳',
                      }),
                      (0, react_jsx_runtime.jsx)('button', {
                        type: 'button',
                        className: `${s.iconBtn} ${s.btnDanger}`,
                        title: t('remove'),
                        'aria-label': t('remove'),
                        onClick: () => {
                          const confirmed = typeof globalThis.confirm === 'function'
                            ? globalThis.confirm(t('removeConfirm', { name }))
                            : true;
                          if (confirmed) onRemove();
                        },
                        children: '✕',
                      }),
                    ],
                  }),
                ],
              }),
              usage === undefined
                ? null
                : (0, react_jsx_runtime.jsx)('div', {
                    className: s.keyBottom,
                    children: quotaFailed
                      ? (0, react_jsx_runtime.jsx)('span', { className: s.quotaReset, children: t('usageError') })
                      : (0, react_jsx_runtime.jsx)('span', {
                        className: s.quotaLines,
                        children: [
                          // The 5-hour window.
                          (0, react_jsx_runtime.jsxs)('span', {
                            className: s.quotaLine,
                            children: [
                              (0, react_jsx_runtime.jsx)('span', { className: s.quotaLabel, children: t('intervalWindow') }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaTrack,
                                children: (0, react_jsx_runtime.jsx)('span', {
                                  className: fillOf(intervalPercent),
                                  style: { width: `${intervalPercent === undefined ? 0 : Math.max(0, Math.min(100, intervalPercent))}%` },
                                }),
                              }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaValue,
                                children: intervalPercent === undefined ? '–' : `${Math.round(intervalPercent)}%`,
                              }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaReset,
                                children: intervalResetIn !== undefined
                                  ? t('resetsIn', { duration: formatDuration(intervalResetIn, t) })
                                  : '–',
                              }),
                            ],
                          }),
                          // The weekly window.
                          (0, react_jsx_runtime.jsxs)('span', {
                            className: s.quotaLine,
                            children: [
                              (0, react_jsx_runtime.jsx)('span', { className: s.quotaLabel, children: t('weeklyWindow') }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaTrack,
                                children: (0, react_jsx_runtime.jsx)('span', {
                                  className: fillOf(weeklyPercent),
                                  style: { width: `${weeklyPercent === undefined ? 0 : Math.max(0, Math.min(100, weeklyPercent))}%` },
                                }),
                              }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaValue,
                                children: weeklyPercent === undefined ? '–' : `${Math.round(weeklyPercent)}%`,
                              }),
                              (0, react_jsx_runtime.jsx)('span', {
                                className: s.quotaReset,
                                children: weeklyResetIn !== undefined
                                  ? t('resetsIn', { duration: formatDuration(weeklyResetIn, t) })
                                  : '–',
                              }),
                            ],
                          }),
                        ],
                      }),
                  }),
            ],
          }),
          replacing
            ? (0, react_jsx_runtime.jsxs)('div', {
                className: s.addRow,
                children: [
                  (0, react_jsx_runtime.jsx)('p', { className: s.hint, children: t('replaceHint') }),
                  (0, react_jsx_runtime.jsx)('input', {
                    className: `${s.input} ${s.keyInput}`,
                    type: 'password',
                    value: replacement,
                    placeholder: t('keyValuePlaceholder'),
                    'aria-label': t('replace'),
                    autoComplete: 'new-password',
                    spellCheck: false,
                    onChange: (event) => setReplacement(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      commitReplacement();
                    },
                  }),
                  (0, react_jsx_runtime.jsx)('button', {
                    type: 'button',
                    className: `${s.btn} ${s.btnSm} ${s.btnPrimary}`,
                    onClick: commitReplacement,
                    disabled: replacement.trim() === '',
                    children: t('replace'),
                  }),
                  (0, react_jsx_runtime.jsx)('button', {
                    type: 'button',
                    className: `${s.btn} ${s.btnSm}`,
                    onClick: onToggleReplace,
                    children: t('cancel'),
                  }),
                ],
              })
            : null,
        ],
      });
    }
    //#endregion
    //#endregion
    //#region src/client/index.js
    /** Required services (cordis fiber inject). */
    const inject = [
      'slots',
      'locale',
      'remote',
      'remote.credentials',
      'remote.llm',
      'remote.settings',
      'configForms',
    ];

    /**
     * Mount the key-pool configuration page as a tab of the Host's Plugins
     * settings section.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'ui-key-pool: dictionaries');
      const t = ctx.locale.bind(LOCALE_NS);

      // The registration is deliberately NOT gated behind
      // `configForms.whileServed`. That gate fires only once the Host's
      // settings mirror holds the namespace, and the mirror has no view at
      // boot — a gated registration never appears and the settings section
      // shows no tab at all. The page reads the form lazily instead, and
      // renders its own empty state when the namespace is not served.
      const controller = new KeyPoolController(ctx.configForms.get(NS), ctx.remote);
      // The page as a tab of the built-in Plugins settings section.
      // The owner renders each cell's contribution inside its own tab panel
      // and projects the `label` thunk on every render, so the tab text
      // follows the active locale without re-registering.
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: BUNDLE_NAME,
        order: 20,
        label: () => t('tab'),
        locale: LOCALE_NS,
        inject: () => controller.face(),
      }, KeyPoolPage));

      // The composer-row indicator.
      //
      // `modelDirectories` resolves the session's selected model, whose
      // provider names the route this indicator reports on. The service is
      // optional: a profile without it still gets the settings page, and the
      // indicator simply never appears.
      ctx.inject(['modelDirectories'], (scoped) => {
        if (scoped?.modelDirectories === undefined) return;
        // The composer tool row's right cell: the Host renders it in the
        // same flex row as the model selector, immediately before it.
        // The cell is allocated by the row itself, so the indicator needs
        // no measurement and no positioning of its own.
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'multi-key-rotation-usage',
          order: 3,
          label: () => t('indicatorTitle'),
          locale: LOCALE_NS,
          inject: (sessionId) => ({
            directory: directoryOf(scoped.modelDirectories, sessionId),
            // The list is read on every render, so a pool that is switched on
            // after this page loaded still gets its indicator.
            pooledProviders: () => controller.pooledProviders(),
            t,
          }),
        }, PoolUsageIndicator));
      });
    }
    //#endregion
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
