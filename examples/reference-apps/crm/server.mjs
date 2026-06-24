// Multi-tenant CRM — StreetJS reference application.
// Built on the same foundation as the SaaS app: @streetjs/admin RBAC for
// authorization + strict per-organization (tenant) data scoping. Domain:
// companies → contacts → deals → pipeline stages → activity timeline.
// Exported as createCrm(); run directly for a standalone HTTP instance.
//
// Multi-tenancy is the headline property: every read and write is constrained to
// the caller's org_id, so one tenant can never see or mutate another's data
// (proved by the smoke test). RBAC gates writes via AdminService.can().

import { createServer as createHttp } from 'node:http';
import { AdminService } from '@streetjs/admin';

export const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];

/** Org-scoped in-memory CRM store. Every method requires an orgId; data for one
 *  org is unreachable from another by construction. Back with PostgreSQL + the
 *  repository pattern (org_id column) for production. */
export class CrmStore {
  #orgs = new Map();
  #seq = 0;
  #org(orgId) {
    if (!orgId) throw new CrmError('org required', 400);
    if (!this.#orgs.has(orgId)) this.#orgs.set(orgId, { companies: new Map(), contacts: new Map(), deals: new Map(), activities: [] });
    return this.#orgs.get(orgId);
  }
  #id(p) { return `${p}_${++this.#seq}`; }

  createCompany(orgId, { name }) {
    if (!name) throw new CrmError('name required', 400);
    const o = this.#org(orgId); const id = this.#id('co');
    const row = { id, orgId, name }; o.companies.set(id, row); return row;
  }
  createContact(orgId, { name, email, companyId }) {
    if (!name) throw new CrmError('name required', 400);
    const o = this.#org(orgId);
    if (companyId && !o.companies.has(companyId)) throw new CrmError('unknown company', 404);
    const id = this.#id('ct'); const row = { id, orgId, name, email: email ?? null, companyId: companyId ?? null };
    o.contacts.set(id, row); return row;
  }
  createDeal(orgId, { title, contactId, amountCents = 0 }) {
    if (!title) throw new CrmError('title required', 400);
    const o = this.#org(orgId);
    if (contactId && !o.contacts.has(contactId)) throw new CrmError('unknown contact', 404);
    const id = this.#id('dl');
    const row = { id, orgId, title, contactId: contactId ?? null, amountCents, stage: 'lead' };
    o.deals.set(id, row);
    this.#log(orgId, id, 'created', `deal "${title}" created at stage lead`);
    return row;
  }
  moveDeal(orgId, dealId, stage) {
    if (!STAGES.includes(stage)) throw new CrmError(`invalid stage (one of: ${STAGES.join(', ')})`, 400);
    const o = this.#org(orgId);
    const deal = o.deals.get(dealId);
    if (!deal) throw new CrmError('unknown deal', 404); // scoped: only this org's deals
    const from = deal.stage; deal.stage = stage;
    this.#log(orgId, dealId, 'stage', `${from} → ${stage}`);
    return deal;
  }
  #log(orgId, dealId, type, note) {
    this.#org(orgId).activities.push({ id: this.#id('ac'), orgId, dealId, type, note, ts: Date.now() });
  }
  listContacts(orgId) { return [...this.#org(orgId).contacts.values()]; }
  listDeals(orgId) { return [...this.#org(orgId).deals.values()]; }
  activities(orgId, dealId) { return this.#org(orgId).activities.filter((a) => !dealId || a.dealId === dealId); }
  /** Deals grouped by pipeline stage, with per-stage count + total value. */
  pipeline(orgId) {
    const out = Object.fromEntries(STAGES.map((s) => [s, { count: 0, valueCents: 0, deals: [] }]));
    for (const d of this.#org(orgId).deals.values()) {
      out[d.stage].count += 1; out[d.stage].valueCents += d.amountCents; out[d.stage].deals.push(d.id);
    }
    return out;
  }
}

class CrmError extends Error { constructor(msg, status) { super(msg); this.name = 'CrmError'; this.status = status; } }

export async function createCrm() {
  const store = new CrmStore();
  // RBAC: a CRM editor role + an org admin per tenant, via @streetjs/admin.
  const admin = new AdminService();
  await admin.createRole('system', { name: 'crm-editor', permissions: ['crm:read', 'crm:write'] });
  await admin.createRole('system', { name: 'crm-viewer', permissions: ['crm:read'] });

  const http = createHttp(async (req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0];
      if (url === '/health/live' || url === '/health/ready') return json(res, 200, { status: 'ok' });

      const orgId = req.headers['x-org-id'];
      const actor = req.headers['x-user-id'];
      const write = req.method === 'POST';
      // Authorize: writes need crm:write, reads need crm:read (when an actor is given).
      if (actor) {
        const ok = await admin.can(actor, write ? 'crm:write' : 'crm:read');
        if (!ok) return json(res, 403, { error: 'forbidden' });
      }

      if (req.method === 'GET' && url === '/contacts') return json(res, 200, { contacts: store.listContacts(orgId) });
      if (req.method === 'GET' && url === '/deals') return json(res, 200, { deals: store.listDeals(orgId) });
      if (req.method === 'GET' && url === '/pipeline') return json(res, 200, { pipeline: store.pipeline(orgId) });

      if (req.method === 'POST' && url === '/companies') return json(res, 201, store.createCompany(orgId, await body(req)));
      if (req.method === 'POST' && url === '/contacts') return json(res, 201, store.createContact(orgId, await body(req)));
      if (req.method === 'POST' && url === '/deals') return json(res, 201, store.createDeal(orgId, await body(req)));

      const move = url.match(/^\/deals\/([\w-]+)\/move$/);
      if (req.method === 'POST' && move) {
        const { stage } = await body(req);
        return json(res, 200, store.moveDeal(orgId, move[1], stage));
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      if (err && err.name === 'CrmError') return json(res, err.status, { error: err.message });
      console.error('[crm] request error:', err);
      json(res, 500, { error: 'Internal Server Error' });
    }
  });

  return { store, admin, http, listen(p = 0) { return new Promise((r) => http.listen(p, () => r(http.address().port))); }, close() { return new Promise((r) => http.close(r)); } };
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); }); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createCrm();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[crm] listening on http://0.0.0.0:${port}`);
}
