export const STYLES = `
.pc-root {
  --pc-accent: #6b4eff;
  --pc-accent-soft: rgba(107, 78, 255, 0.12);
  --pc-ink: #191722;
  --pc-canvas-bg: #e9e5dc;
  --pc-radius: 8px;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--pc-canvas-bg);
  color: var(--pc-ink);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.pc-root *, .pc-root *::before, .pc-root *::after { box-sizing: border-box; }
.pc-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 36px 28px 64px;
  outline: none;
  overscroll-behavior: contain;
}
.pc-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
  min-height: 100%;
  width: max-content;
  min-width: 100%;
}
.pc-page {
  position: relative;
  flex: none;
  background: #ffffff;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(23, 21, 31, 0.1), 0 14px 38px -18px rgba(23, 21, 31, 0.45);
}
.pc-page > canvas {
  display: block;
  border-radius: 2px;
  background: #ffffff;
}
.pc-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pc-obj {
  position: absolute;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.pc-obj-text {
  white-space: pre;
  line-height: 1.25;
  cursor: move;
  outline: none;
  overflow: visible;
  transform-origin: top left;
}
.pc-obj-text[contenteditable="true"] {
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
  outline: 1.5px dashed var(--pc-accent);
  outline-offset: 2px;
  min-width: 4px;
}
.pc-obj-text:empty::before {
  content: attr(data-placeholder);
  color: rgba(25, 23, 34, 0.35);
}
.pc-obj-image { cursor: move; }
.pc-obj-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  -webkit-user-drag: none;
}
.pc-obj-shape { cursor: move; }
.pc-obj-shape[data-shape="ellipse"] { border-radius: 50%; }
.pc-obj-line, .pc-obj-pen { cursor: move; }
.pc-obj-line svg, .pc-obj-pen svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.pc-selection {
  position: absolute;
  z-index: 90;
  pointer-events: none;
  border: 1.5px solid var(--pc-accent);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
}
.pc-orig-hit {
  position: absolute;
  z-index: 30;
  pointer-events: auto;
  cursor: text;
  border: 1px dashed transparent;
  border-radius: 2px;
}
.pc-orig-hit:hover {
  border-color: var(--pc-accent);
  background: rgba(107, 78, 255, 0.08);
}
.pc-orig-preview {
  position: absolute;
  z-index: 20;
  pointer-events: none;
  white-space: pre;
  line-height: 1.25;
  padding: 0;
  margin: 0;
  border-radius: 1px;
}
.pc-orig-editor {
  position: absolute;
  z-index: 60;
  white-space: pre;
  line-height: 1.25;
  padding: 0 1px;
  margin: 0;
  outline: 1.5px solid var(--pc-accent);
  box-shadow: 0 2px 10px rgba(25, 23, 34, 0.18);
  cursor: text;
}
.pc-root[data-tool="text-edit"] .pc-page { cursor: text; }
.pc-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: 0;
  padding: 0;
  border: 1.5px solid var(--pc-accent);
  border-radius: 3px;
  background: #ffffff;
  pointer-events: auto;
  touch-action: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.pc-handle[data-corner="nw"] { cursor: nwse-resize; }
.pc-handle[data-corner="ne"] { cursor: nesw-resize; }
.pc-handle[data-corner="sw"] { cursor: nesw-resize; }
.pc-handle[data-corner="se"] { cursor: nwse-resize; }
.pc-guide {
  position: absolute;
  z-index: 80;
  pointer-events: none;
  background: var(--pc-accent);
  opacity: 0.85;
}
.pc-guide-v { width: 1px; top: 0; bottom: 0; }
.pc-guide-h { height: 1px; left: 0; right: 0; }
.pc-root[data-tool="text"] .pc-page { cursor: text; }
.pc-root:not([data-tool="select"]) .pc-page { touch-action: none; }
.pc-root[data-tool="image"] .pc-page { cursor: copy; }
.pc-root[data-tool="rect"] .pc-page,
.pc-root[data-tool="ellipse"] .pc-page,
.pc-root[data-tool="line"] .pc-page,
.pc-root[data-tool="pen"] .pc-page,
.pc-root[data-tool="highlight"] .pc-page,
.pc-root[data-tool="whiteout"] .pc-page { cursor: crosshair; }
.pc-root.pc-dragover::after {
  content: "Rilascia qui";
  position: absolute;
  inset: 12px;
  z-index: 200;
  display: grid;
  place-items: center;
  border: 2px dashed var(--pc-accent);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--pc-accent);
  font-size: 15px;
  font-weight: 650;
  backdrop-filter: blur(3px);
  pointer-events: none;
}
@media (max-width: 720px) {
  .pc-viewport { padding: 18px 12px 42px; }
  .pc-pages { gap: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .pc-root * { scroll-behavior: auto !important; }
}
`;
