// Shared, dependency-free UI primitives + theming for @streetjs/ai-ui.
// CSS-variable driven with built-in dark mode; no CSS-in-JS runtime.

import { createElement, type ReactNode } from 'react';

export type ClassNames = Record<string, string | undefined>;

/** createElement alias to keep component code terse and JSX-free. */
export const h = createElement;

export const streetAiCss = `
.street-ai {
  --st-bg: #ffffff; --st-fg: #111827; --st-muted: #6b7280;
  --st-border: #d1d5db; --st-accent: #2563eb; --st-accent-fg: #ffffff;
  --st-user-bg: #eff6ff; --st-assistant-bg: #f3f4f6; --st-radius: 8px;
  color: var(--st-fg); background: var(--st-bg); font-family: system-ui, sans-serif;
  border: 1px solid var(--st-border); border-radius: var(--st-radius);
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
}
@media (prefers-color-scheme: dark) {
  .street-ai:not([data-theme="light"]) {
    --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af; --st-border: #374151;
    --st-accent: #3b82f6; --st-user-bg: #1e293b; --st-assistant-bg: #111827;
  }
}
.street-ai[data-theme="dark"] {
  --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af; --st-border: #374151;
  --st-accent: #3b82f6; --st-user-bg: #1e293b; --st-assistant-bg: #111827;
}
.street-ai .st-msgs { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 480px; }
.street-ai .st-msg { padding: 8px 10px; border-radius: var(--st-radius); font-size: 14px; white-space: pre-wrap; }
.street-ai .st-msg[data-role="user"] { background: var(--st-user-bg); align-self: flex-end; }
.street-ai .st-msg[data-role="assistant"] { background: var(--st-assistant-bg); align-self: flex-start; }
.street-ai .st-cursor { animation: st-blink 1s steps(2) infinite; }
@keyframes st-blink { 0%,50% { opacity: 1; } 50.01%,100% { opacity: 0; } }
.street-ai form { display: flex; gap: 8px; }
.street-ai input { flex: 1; padding: 8px 10px; border: 1px solid var(--st-border);
  border-radius: var(--st-radius); background: var(--st-bg); color: var(--st-fg); font-size: 14px; }
.street-ai input:focus-visible { outline: 2px solid var(--st-accent); outline-offset: 1px; }
.street-ai button { padding: 8px 14px; border: none; border-radius: var(--st-radius);
  background: var(--st-accent); color: var(--st-accent-fg); font-size: 14px; cursor: pointer; }
.street-ai button:disabled { opacity: .6; cursor: not-allowed; }
.street-ai .st-tool { border: 1px solid var(--st-border); border-radius: var(--st-radius); padding: 8px; font-size: 13px; }
.street-ai .st-muted { color: var(--st-muted); font-size: 13px; }
`;

/** Injects the default stylesheet once. Optional — consumers may supply their own CSS. */
export function StreetAIStyles(): ReactNode {
  return h('style', { 'data-street-ai-styles': '' }, streetAiCss);
}
