// Shared, dependency-free UI primitives + theming for @streetjs/auth-ui.
// All styling is driven by CSS custom properties so consumers can theme and
// support dark mode without any CSS-in-JS runtime. Components accept optional
// `classNames` so they can opt out of the defaults entirely.

import { createElement, type CSSProperties, type ReactNode } from 'react';

export type ClassNames = Record<string, string | undefined>;

/** Small createElement alias to keep component code terse and JSX-free. */
export const h = createElement;

/**
 * Default stylesheet exposed as a string + a <StreetAuthStyles/> component that
 * injects it. Uses CSS variables with a light default and a dark override via
 * `prefers-color-scheme` and an explicit `[data-theme="dark"]` hook.
 */
export const streetAuthCss = `
.street-auth {
  --st-bg: #ffffff; --st-fg: #111827; --st-muted: #6b7280;
  --st-border: #d1d5db; --st-accent: #2563eb; --st-accent-fg: #ffffff;
  --st-error: #dc2626; --st-radius: 8px; --st-gap: 12px;
  color: var(--st-fg); background: var(--st-bg);
  font-family: system-ui, sans-serif; max-width: 360px; padding: 24px;
  border: 1px solid var(--st-border); border-radius: var(--st-radius);
  display: flex; flex-direction: column; gap: var(--st-gap);
}
@media (prefers-color-scheme: dark) {
  .street-auth:not([data-theme="light"]) {
    --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af;
    --st-border: #374151; --st-accent: #3b82f6; --st-accent-fg: #ffffff;
    --st-error: #f87171;
  }
}
.street-auth[data-theme="dark"] {
  --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af;
  --st-border: #374151; --st-accent: #3b82f6; --st-accent-fg: #ffffff;
  --st-error: #f87171;
}
.street-auth label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.street-auth input { padding: 8px 10px; border: 1px solid var(--st-border);
  border-radius: var(--st-radius); background: var(--st-bg); color: var(--st-fg); font-size: 14px; }
.street-auth input:focus-visible { outline: 2px solid var(--st-accent); outline-offset: 1px; }
.street-auth button { padding: 10px 12px; border: none; border-radius: var(--st-radius);
  background: var(--st-accent); color: var(--st-accent-fg); font-size: 14px; cursor: pointer; }
.street-auth button:disabled { opacity: .6; cursor: not-allowed; }
.street-auth .st-error { color: var(--st-error); font-size: 13px; }
.street-auth .st-muted { color: var(--st-muted); font-size: 13px; }
`;

/** Injects the default stylesheet once. Optional — consumers may supply their own CSS. */
export function StreetAuthStyles(): ReactNode {
  return h('style', { 'data-street-auth-styles': '' }, streetAuthCss);
}

export interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}

/** Accessible labelled input (label is programmatically associated via htmlFor/id). */
export function Field(props: FieldProps): ReactNode {
  return h('label', { htmlFor: props.id, className: props.className },
    props.label,
    h('input', {
      id: props.id,
      name: props.id,
      type: props.type ?? 'text',
      value: props.value,
      required: props.required,
      autoComplete: props.autoComplete,
      'aria-required': props.required ? 'true' : undefined,
      onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    }),
  );
}

export interface ButtonProps {
  children?: ReactNode;
  type?: 'submit' | 'button';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function Button(props: ButtonProps): ReactNode {
  return h('button', {
    type: props.type ?? 'button',
    disabled: props.disabled,
    onClick: props.onClick,
    className: props.className,
    style: props.style,
  }, props.children);
}

/** Inline, screen-reader-announced error region. */
export function ErrorText({ error }: { error?: unknown }): ReactNode {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return h('p', { className: 'st-error', role: 'alert' }, msg);
}
