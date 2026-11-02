export const EDITOR_STYLES = `
.pce {
  --pce-accent: #6b4eff;
  --pce-ink: #191722;
  --pce-muted: #6f6a63;
  --pce-line: #e3dac9;
  --pce-paper: #fffdf8;
  --pce-cream: #f6f1e7;
  --pce-stage: #e9e5dc;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--pce-stage);
  color: var(--pce-ink);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.pce *, .pce *::before, .pce *::after { box-sizing: border-box; }
.pce button, .pce input, .pce select { font: inherit; }
.pce button { cursor: pointer; }
.pce-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 56px;
  flex: 0 0 56px;
  padding: 0 10px;
  border-bottom: 1px solid var(--pce-line);
  background: var(--pce-paper);
  z-index: 20;
}
.pce-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--pce-ink);
  text-decoration: none;
  padding: 4px 6px;
  border-radius: 10px;
}
.pce-brand:hover { background: var(--pce-cream); }
.pce-brand svg { width: 28px; height: 28px; }
.pce-brand span { font-weight: 750; letter-spacing: -0.03em; font-size: 17px; }
.pce-file { min-width: 0; display: flex; flex-direction: column; padding: 0 4px; }
.pce-file strong { max-width: 220px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.pce-file small { color: var(--pce-muted); font-size: 10px; }
.pce-center { display: flex; align-items: center; gap: 2px; margin: 0 auto; }
.pce-zoomgroup { display: inline-flex; align-items: center; gap: 2px; }
.pce-right { display: flex; align-items: center; gap: 6px; }
.pce-mobile-zoom {
  position: absolute;
  bottom: 12px;
  left: 50%;
  z-index: 9;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--pce-line);
  border-radius: 999px;
  background: var(--pce-paper);
  box-shadow: 0 12px 34px -22px rgba(25,23,34,.55);
  transform: translateX(-50%);
}
.pce-mobile-zoom span {
  min-width: 42px;
  padding: 0 4px;
  color: var(--pce-muted);
  font-size: 11px;
  font-weight: 650;
  text-align: center;
  cursor: pointer;
}
.pce-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #5d5852;
}
.pce-iconbtn:hover { background: var(--pce-cream); color: var(--pce-ink); }
.pce-iconbtn:disabled { opacity: .3; cursor: default; }
.pce-iconbtn svg { width: 17px; height: 17px; }
.pce-zoom {
  min-width: 48px;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--pce-muted);
  font-size: 11px;
  font-weight: 650;
}
.pce-zoom:hover { background: var(--pce-cream); color: var(--pce-ink); }
.pce-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--pce-cream);
  color: var(--pce-muted);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.pce-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--pce-accent);
  color: white;
  font-size: 12px;
  font-weight: 700;
}
.pce-primary:hover { background: #4d34d8; }
.pce-primary:disabled { opacity: .45; cursor: default; }
.pce-outline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--pce-line);
  border-radius: 10px;
  background: var(--pce-paper);
  color: var(--pce-ink);
  font-size: 12px;
  font-weight: 650;
}
.pce-outline:hover { border-color: #bdb2a0; background: white; }
.pce-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 52px;
  flex: 0 0 52px;
  padding: 0 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--pce-line);
  background: var(--pce-paper);
  scrollbar-width: none;
  z-index: 15;
}
.pce-tools::-webkit-scrollbar { display: none; }
.pce-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  min-width: 36px;
  padding: 0 9px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #5d5852;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.pce-tool:hover { background: var(--pce-cream); color: var(--pce-ink); }
.pce-tool[aria-pressed="true"] { background: var(--pce-accent); color: white; }
.pce-tool svg { width: 17px; height: 17px; }
.pce-sep { width: 1px; height: 22px; margin: 0 4px; background: var(--pce-line); flex: 0 0 1px; }
.pce-body { display: flex; flex: 1; min-height: 0; position: relative; }
.pce-pages {
  display: flex;
  flex-direction: column;
  width: 224px;
  flex: 0 0 224px;
  border-right: 1px solid var(--pce-line);
  background: var(--pce-paper);
  z-index: 12;
}
.pce-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 9px;
}
.pce-kicker { margin: 0; color: #9a9389; font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.pce-panel-title { margin: 1px 0 0; font-size: 16px; font-weight: 750; letter-spacing: -.02em; }
.pce-count { border-radius: 999px; background: var(--pce-cream); padding: 2px 7px; color: var(--pce-muted); font-size: 10px; font-weight: 700; }
.pce-pages [data-pages-close], .pce-inspector [data-inspector-close] { display: none; }
.pce-page-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 7px; }
.pce-page {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
}
.pce-page:hover { background: var(--pce-cream); }
.pce-page[aria-current="page"] { border-color: var(--pce-accent); background: color-mix(in srgb, var(--pce-accent) 6%, white); }
.pce-page.dragging { opacity: .4; }
.pce-page.drop-target { border-color: var(--pce-accent); background: color-mix(in srgb, var(--pce-accent) 10%, white); }
.pce-thumb { width: 48px; flex: 0 0 48px; min-height: 58px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--pce-line); border-radius: 5px; background: white; }
.pce-thumb img { display: block; width: 100%; height: auto; }
.pce-thumb span { color: #b5ada0; font-size: 9px; }
.pce-page-meta { min-width: 0; }
.pce-page-meta strong { display: block; font-size: 11px; }
.pce-page-meta small { display: block; color: var(--pce-muted); font-size: 9px; }
.pce-page-actions { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; padding: 6px; border-top: 1px solid var(--pce-line); }
.pce-page-actions button { display: inline-flex; align-items: center; justify-content: center; height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--pce-muted); }
.pce-page-actions button:hover { background: var(--pce-cream); color: var(--pce-ink); }
.pce-page-actions button:disabled { opacity: .25; }
.pce-page-actions svg { width: 14px; height: 14px; }
.pce-stage-wrap { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; }
.pce-stage { position: relative; flex: 1; min-height: 0; }
.pce-stage > .pc-root { height: 100%; }
.pce-empty {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: none;
}
.pce-empty[hidden] { display: none; }
.pce-empty-card {
  max-width: 340px;
  padding: 24px;
  border: 1px solid var(--pce-line);
  border-radius: 22px;
  background: var(--pce-paper);
  text-align: center;
  pointer-events: auto;
  box-shadow: 0 30px 80px -50px rgba(25,23,34,.6);
}
.pce-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  margin-bottom: 10px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--pce-accent) 12%, white);
  color: var(--pce-accent);
}
.pce-empty-card h2 { margin: 0; font-size: 20px; font-weight: 750; letter-spacing: -.03em; }
.pce-empty-card p { margin: 7px 0 14px; color: var(--pce-muted); font-size: 12px; line-height: 1.5; }
.pce-inspector {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex: 0 0 280px;
  border-left: 1px solid var(--pce-line);
  background: var(--pce-paper);
  overflow-y: auto;
  z-index: 12;
}
.pce-form { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 16px; }
.pce-field { display: flex; flex-direction: column; gap: 4px; }
.pce-label { color: #8d867b; font-size: 9px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.pce-input, .pce-select {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #ded5c7;
  border-radius: 8px;
  background: white;
  color: var(--pce-ink);
  font-size: 11px;
}
.pce-input[type="color"] { padding: 4px; }
.pce-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.pce-btnrow { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pce-smallbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  border: 1px solid var(--pce-line);
  border-radius: 8px;
  background: var(--pce-paper);
  color: var(--pce-muted);
  font-size: 10px;
  font-weight: 650;
}
.pce-smallbtn:hover { border-color: #bdb2a0; color: var(--pce-ink); }
.pce-smallbtn.danger:hover { border-color: #c7442e; color: #c7442e; }
.pce-smallbtn svg { width: 13px; height: 13px; }
.pce-note { border: 1px solid var(--pce-line); border-radius: 10px; padding: 9px 10px; color: var(--pce-muted); font-size: 10px; line-height: 1.5; background: var(--pce-cream); }
.pce-textbar {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: calc(100% - 16px);
  padding: 5px;
  border: 1px solid var(--pce-line);
  border-radius: 13px;
  background: white;
  box-shadow: 0 16px 50px -28px rgba(25,23,34,.65);
  transform: translateX(-50%);
}
.pce-textbar button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--pce-muted); }
.pce-textbar button:hover { background: var(--pce-cream); color: var(--pce-ink); }
.pce-textbar button[aria-pressed="true"] { background: var(--pce-accent); color: white; }
.pce-textbar input[type="number"] { width: 48px; height: 30px; border: 1px solid var(--pce-line); border-radius: 8px; text-align: center; font-size: 11px; }
.pce-textbar label { position: relative; display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border: 1px solid var(--pce-line); border-radius: 8px; cursor: pointer; }
.pce-textbar label input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.pce-textbar .swatch { display: block; width: 15px; height: 15px; border: 1px solid rgba(0,0,0,.12); border-radius: 999px; }
.pce-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  background: rgba(25,23,34,.55);
  backdrop-filter: blur(3px);
}
.pce-modal-card { width: 100%; max-width: 560px; max-height: calc(100dvh - 28px); overflow: auto; padding: 18px; border-radius: 20px; background: var(--pce-paper); box-shadow: 0 30px 90px -30px rgba(25,23,34,.7); }
.pce-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pce-modal-title { margin: 0; font-size: 20px; font-weight: 750; letter-spacing: -.03em; }
.pce-signature { display: block; width: 100%; aspect-ratio: 640 / 220; margin-top: 12px; border: 1px dashed #c8bdab; border-radius: 12px; background: white; touch-action: none; cursor: crosshair; }
.pce-modal-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 12px; }
.pce-template-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); margin-top: 12px; }
.pce-template-card { padding: 11px; border: 1px solid var(--pce-line); border-radius: 12px; background: white; text-align: left; }
.pce-template-card:hover { border-color: var(--pce-accent); box-shadow: 0 10px 30px -24px rgba(25,23,34,.6); }
.pce-template-card strong { display: block; font-size: 12px; }
.pce-template-card small { display: block; margin-top: 3px; color: var(--pce-muted); font-size: 10px; line-height: 1.4; }
.pce-toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  z-index: 300;
  max-width: calc(100vw - 32px);
  transform: translateX(-50%);
  padding: 9px 14px;
  border-radius: 999px;
  background: var(--pce-ink);
  color: white;
  font-size: 12px;
  font-weight: 650;
  box-shadow: 0 12px 36px -18px rgba(0,0,0,.6);
}
.pce-toast.error { background: #a63a29; }
.pce-mobile-actions { display: none; }
@media (max-width: 1180px) {
  .pce-inspector { position: fixed; top: 108px; right: 0; bottom: 0; width: 280px; transform: translateX(100%); transition: transform .2s; box-shadow: -18px 0 50px -30px rgba(0,0,0,.4); }
  .pce-inspector.open { transform: translateX(0); }
  .pce-pages [data-pages-close], .pce-inspector [data-inspector-close] { display: inline-flex; }
  .pce-mobile-actions { display: inline-flex; }
  .pce-mobile-actions[data-pages-toggle] { display: none; }
}
@media (max-width: 820px) {
  .pce-pages { position: fixed; top: 108px; left: 0; bottom: 0; width: 224px; transform: translateX(-100%); transition: transform .2s; box-shadow: 18px 0 50px -30px rgba(0,0,0,.4); }
  .pce-pages.open { transform: translateX(0); }
  .pce-file { display: none; }
  .pce-brand span { display: none; }
  .pce-tool-label { display: none; }
  .pce-tool { padding: 0 9px; }
  .pce-zoomgroup { display: none; }
  .pce-center { margin: 0 auto 0 2px; }
  .pce-topbar { gap: 3px; padding: 0 6px; }
  .pce-pill { display: none; }
  .pce-mobile-zoom { display: inline-flex; }
  .pce-mobile-actions[data-pages-toggle] { display: inline-flex; }
  .pce-textbar { top: 6px; }
  .pce-outline span, .pce-primary span { display: none; }
  .pce-outline, .pce-primary { width: 34px; padding: 0; justify-content: center; }
  .pce-empty .pce-primary { width: auto; padding: 0 12px; }
  .pce-empty .pce-primary span { display: inline; }
  .pce-right { gap: 4px; }
}
@media (max-width: 420px) {
  .pce-tools { height: 46px; flex-basis: 46px; padding: 0 5px; }
  .pce-tool { height: 32px; min-width: 32px; padding: 0 7px; }
  .pce-tool svg { width: 16px; height: 16px; }
}
.pce-backdrop { position: fixed; inset: 0; z-index: 10; background: rgba(25,23,34,.28); }
`;
