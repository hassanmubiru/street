// @streetjs/ai-ui — accessible, themeable React AI components built on
// @streetjs/react (which consumes @streetjs/client). Integrates with whatever
// AI provider the backend exposes; components never touch core internals
// (RFC 0002). React is a peer dependency. CSS-variable theming with dark mode.

export {
  Chat,
  StreamingMessage,
  RAGSearch,
  ToolExecutionViewer,
} from './components.js';
export type {
  ChatProps,
  StreamingMessageProps,
  RAGSearchProps,
  ToolExecutionViewerProps,
  ToolCall,
} from './components.js';

export { StreetAIStyles, streetAiCss } from './theme.js';
export type { ClassNames } from './theme.js';
