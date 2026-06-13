// contract-providers.integration.test.ts
// Live contract tests for the real AI providers. Each block is gated on its
// credential/host env var, so the suite skips cleanly when secrets are absent
// (keeping default/offline runs green) and runs a minimal real call when a
// maintainer supplies credentials.
//
//   OPENAI_API_KEY=sk-... npm run test -w packages/ai
//   ANTHROPIC_API_KEY=sk-ant-... npm run test -w packages/ai
//   OLLAMA_HOST=http://127.0.0.1:11434 npm run test -w packages/ai

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAiProvider, AnthropicProvider, OllamaProvider } from '../index.js';

const OPENAI = process.env['OPENAI_API_KEY'];
const ANTHROPIC = process.env['ANTHROPIC_API_KEY'];
const OLLAMA = process.env['OLLAMA_HOST'];

describe('OpenAI contract', { skip: !OPENAI ? 'OPENAI_API_KEY not set' : false }, () => {
  it('chat returns a parsed assistant message + usage', async () => {
    const ai = new OpenAiProvider({ apiKey: OPENAI });
    const res = await ai.chat({ messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 5 });
    assert.equal(res.message.role, 'assistant');
    assert.equal(typeof res.message.content, 'string');
    assert.ok(['stop', 'length'].includes(res.finishReason));
  });

  it('embeddings return vectors of consistent dimensionality', async () => {
    const ai = new OpenAiProvider({ apiKey: OPENAI });
    const res = await ai.embed({ input: ['hello', 'world'] });
    assert.equal(res.embeddings.length, 2);
    assert.ok(res.embeddings[0]!.length > 0);
    assert.equal(res.embeddings[0]!.length, res.embeddings[1]!.length);
  });
});

describe('Anthropic contract', { skip: !ANTHROPIC ? 'ANTHROPIC_API_KEY not set' : false }, () => {
  it('chat returns a parsed assistant message', async () => {
    const ai = new AnthropicProvider({ apiKey: ANTHROPIC });
    const res = await ai.chat({ messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 16 });
    assert.equal(res.message.role, 'assistant');
    assert.ok(res.message.content.length > 0);
  });
});

describe('Ollama contract', { skip: !OLLAMA ? 'OLLAMA_HOST not set' : false }, () => {
  it('chat + embeddings work against a local Ollama', async () => {
    const ai = new OllamaProvider({ baseUrl: OLLAMA });
    const chat = await ai.chat({ messages: [{ role: 'user', content: 'Reply with: pong' }] });
    assert.equal(chat.message.role, 'assistant');
    const emb = await ai.embed({ input: ['hello'] });
    assert.ok(emb.embeddings[0]!.length > 0);
  });
});
