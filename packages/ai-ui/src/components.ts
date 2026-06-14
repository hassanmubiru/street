// AI components for @streetjs/ai-ui. Thin, accessible React views wired to
// @streetjs/react hooks (which talk to @streetjs/client). No provider logic is
// duplicated; components consume the public client/hook surface only (RFC 0002).

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAIChat, useSearch } from '@streetjs/react';
import type { ChatMessage } from '@streetjs/client';
import { h, type ClassNames } from './theme.js';

export interface StreamingMessageProps {
  /** The (possibly partial) assistant text. */
  content: string;
  /** Whether tokens are still streaming — shows a blinking cursor. */
  streaming?: boolean;
  role?: ChatMessage['role'];
}

/** Renders a single chat message, with a live "typing" cursor while streaming. */
export function StreamingMessage(props: StreamingMessageProps): ReactNode {
  const role = props.role ?? 'assistant';
  return h('div', {
    className: 'st-msg',
    'data-role': role,
    'aria-live': props.streaming ? 'polite' : undefined,
  },
    props.content,
    props.streaming ? h('span', { className: 'st-cursor', 'aria-hidden': 'true' }, '▌') : null,
  );
}

export interface ChatProps {
  model?: string;
  path?: string;
  initial?: ChatMessage[];
  placeholder?: string;
  theme?: 'light' | 'dark';
  classNames?: ClassNames;
  title?: string;
}

/** Full chat surface: message list + composer, backed by `useAIChat`. */
export function Chat(props: ChatProps): ReactNode {
  const { messages, streaming, send } = useAIChat({
    ...(props.initial ? { initial: props.initial } : {}),
    ...(props.model ? { model: props.model } : {}),
    ...(props.path ? { path: props.path } : {}),
  });
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    void send(text);
  };

  const lastIndex = messages.length - 1;
  return h('div', { className: props.classNames?.root ?? 'street-ai', 'data-theme': props.theme },
    props.title ? h('h2', null, props.title) : null,
    h('div', { className: 'st-msgs', ref: listRef, role: 'log', 'aria-label': 'Conversation' },
      messages.length === 0
        ? h('p', { className: 'st-muted' }, 'Ask anything to get started.')
        : messages.map((m, i) => h(StreamingMessage, {
            key: i,
            role: m.role,
            content: m.content,
            streaming: streaming && i === lastIndex && m.role === 'assistant',
          })),
    ),
    h('form', { onSubmit: submit },
      h('input', {
        type: 'text',
        value: draft,
        placeholder: props.placeholder ?? 'Type a message…',
        'aria-label': 'Message',
        disabled: streaming,
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      }),
      h('button', { type: 'submit', disabled: streaming || draft.trim() === '' }, streaming ? '…' : 'Send'),
    ),
  );
}

export interface RAGSearchProps<T = unknown> {
  /** Debounce delay in ms before issuing a search (default 250). */
  debounceMs?: number;
  placeholder?: string;
  theme?: 'light' | 'dark';
  classNames?: ClassNames;
  /** Render a single hit. Defaults to JSON-ish text. */
  renderHit?: (hit: T, index: number) => ReactNode;
}

/** Retrieval/search box that renders ranked hits via `useSearch`. */
export function RAGSearch<T = unknown>(props: RAGSearchProps<T>): ReactNode {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), props.debounceMs ?? 250);
    return () => clearTimeout(t);
  }, [input, props.debounceMs]);

  const { data, loading, error } = useSearch<T[]>(query);
  const hits = Array.isArray(data) ? data : [];
  const renderHit = props.renderHit ?? ((hit: T) => JSON.stringify(hit));

  return h('div', { className: props.classNames?.root ?? 'street-ai', 'data-theme': props.theme },
    h('input', {
      type: 'search',
      value: input,
      placeholder: props.placeholder ?? 'Search…',
      'aria-label': 'Search query',
      onChange: (e: { target: { value: string } }) => setInput(e.target.value),
    }),
    loading && query ? h('p', { className: 'st-muted', role: 'status' }, 'Searching…') : null,
    error ? h('p', { className: 'st-muted', role: 'alert' }, 'Search failed.') : null,
    h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
      hits.map((hit, i) => h('li', { key: i, className: 'st-tool' }, renderHit(hit, i))),
    ),
    query && !loading && hits.length === 0 && !error
      ? h('p', { className: 'st-muted' }, 'No results.')
      : null,
  );
}

export interface ToolCall {
  /** Tool / function name. */
  name: string;
  /** Arguments passed to the tool (object or pre-serialized string). */
  arguments?: unknown;
  /** Result returned by the tool, when complete. */
  result?: unknown;
  /** Lifecycle status. */
  status?: 'pending' | 'running' | 'success' | 'error';
  /** Error message when status === 'error'. */
  error?: string;
}

export interface ToolExecutionViewerProps {
  calls: ToolCall[];
  theme?: 'light' | 'dark';
  classNames?: ClassNames;
}

const STATUS_LABEL: Record<NonNullable<ToolCall['status']>, string> = {
  pending: '⏳ pending', running: '⚙️ running', success: '✓ success', error: '✗ error',
};

function fmt(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/** Inspects AI tool/function calls: name, args, status and result. */
export function ToolExecutionViewer(props: ToolExecutionViewerProps): ReactNode {
  return h('div', { className: props.classNames?.root ?? 'street-ai', 'data-theme': props.theme },
    props.calls.length === 0
      ? h('p', { className: 'st-muted' }, 'No tool calls.')
      : props.calls.map((call, i) => h('div', { key: i, className: 'st-tool' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
            h('strong', null, call.name),
            h('span', { className: 'st-muted' }, STATUS_LABEL[call.status ?? 'pending']),
          ),
          call.arguments !== undefined
            ? h('details', null, h('summary', { className: 'st-muted' }, 'Arguments'), h('pre', null, fmt(call.arguments)))
            : null,
          call.result !== undefined
            ? h('details', null, h('summary', { className: 'st-muted' }, 'Result'), h('pre', null, fmt(call.result)))
            : null,
          call.error ? h('p', { role: 'alert', style: { color: 'crimson' } }, call.error) : null,
        )),
  );
}
