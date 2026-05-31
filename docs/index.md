---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street — production-grade, memory-safe TypeScript backend framework built on Node.js core. Native PostgreSQL driver, JWT, WebSockets, clustering. 2 dependencies."
---

<style>
/* ═══════════════════════════════════════════════════════════════════════════
   STREET FRAMEWORK — DESIGN SYSTEM
   Electric Blue + Indigo palette · Inter + JetBrains Mono
   ═══════════════════════════════════════════════════════════════════════════ */

:root {
  --st-blue:          #2563EB;
  --st-blue-hover:    #1D4ED8;
  --st-blue-active:   #1E40AF;
  --st-indigo:        #6366F1;
  --st-indigo-hover:  #4F46E5;
  --st-sky:           #38BDF8;
  --st-green:         #22C55E;
  --st-yellow:        #F59E0B;
  --st-red:           #EF4444;

  --st-bg:            #0A0E1A;
  --st-surface:       #0F1629;
  --st-card:          #141C2E;
  --st-card-hover:    #1A2540;
  --st-border:        #1E2D4A;
  --st-border-hover:  #2563EB;

  --st-text-primary:  #F1F5F9;
  --st-text-secondary:#94A3B8;
  --st-text-muted:    #475569;

  --st-radius-sm:     6px;
  --st-radius:        10px;
  --st-radius-lg:     16px;

  --st-font-head:     'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --st-font-body:     'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --st-font-mono:     'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;

  --st-shadow-sm:     0 1px 3px rgba(0,0,0,0.4);
  --st-shadow:        0 4px 16px rgba(0,0,0,0.5);
  --st-shadow-lg:     0 8px 32px rgba(0,0,0,0.6);
  --st-shadow-blue:   0 4px 24px rgba(37,99,235,0.25);
  --st-shadow-glow:   0 0 40px rgba(37,99,235,0.15);

  --st-transition:    all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

/* ── Reset & base ─────────────────────────────────────────────────────────── */
.street-page * { box-sizing: border-box; }
.street-page { font-family: var(--st-font-body); color: var(--st-text-primary); }

/* ── Gradient text utility ────────────────────────────────────────────────── */
.grad-text {
  background: linear-gradient(135deg, #F1F5F9 0%, var(--st-sky) 50%, var(--st-indigo) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.grad-text-blue {
  background: linear-gradient(135deg, var(--st-blue) 0%, var(--st-sky) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
</style>
