---
layout:      default
title:       "AI Assistant — built with StreetJS"
permalink:   /showcase/ai-assistant/
nav_exclude: true
description:  "A retrieval-augmented AI assistant backend built with StreetJS and @streetjs/ai — ingest, embeddings, grounded retrieval, tool-calling."
---

# AI Assistant — built with StreetJS

**RAG · Embeddings · Tool-calling — grounded answers on `@streetjs/ai`.**

- **Live demo:** _coming soon_ (demo-safe mode — see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/reference-apps/ai-assistant`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/ai-assistant)
- **Deploy:** [`deploy/cloud-run/service.yaml`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [AI](/StreetJS/ai/)

## Architecture

```
Docs ─▶ ingest ─▶ embeddings ─▶ vector store
User question ─▶ retrieve (grounded) ─▶ prompt + tool-calling loop (@streetjs/ai) ─▶ grounded answer
```

The assistant retrieves relevant context before answering (RAG), so responses are
grounded in the ingested knowledge base, and runs a tool-calling loop for actions
beyond plain text.

## Run it locally

```bash
npm run build -w packages/core
node examples/reference-apps/ai-assistant/server.mjs        # :3000
node examples/reference-apps/ai-assistant/smoke-test.mjs    # checks pass
```

## Public-demo safety

A hosted instance runs in **demo-safe mode**: either a hard token/request budget
cap behind strict rate limiting, or canned, deterministic fixture answers — so the
public demo can never incur unbounded model spend (see the demo plan).

## Learning path

1. [REST API](/StreetJS/showcase/)
2. AI chat
3. Embeddings & RAG
4. **Tool-calling**

> A real, CI-tested reference app. Browse all demos in the
> [Showcase](/StreetJS/showcase/).
