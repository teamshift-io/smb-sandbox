import { generate } from "@teamshift/fake-business";
import { describe, expect, it } from "vitest";
import { SandboxStore } from "../src/index.js";

// Runs against the real generator (requires packages/fake-business to be built).
describe("integration with @teamshift/fake-business", () => {
  const dataset = generate({ industry: "home-services", seed: 42 });

  it("loads a generated dataset and serves consistent reads", () => {
    const store = new SandboxStore(dataset);
    expect(store.getCompany().industry).toBe("home-services");
    expect(store.today()).toBe(dataset.meta.asOf);
    expect(store.searchContacts({ limit: 100 }).total).toBe(dataset.contacts.length);
    expect(store.listInvoices({ limit: 1 }).total).toBe(dataset.invoices.length);
    expect(store.listThreads({ limit: 1 }).total).toBeGreaterThan(0);
    expect(store.getAnomalies()).toEqual(dataset.anomalies);
    for (const a of dataset.anomalies) for (const id of a.recordIds) expect(store.getRecord(id), `${a.kind} → ${id}`).not.toBeNull();
  });

  it("can act on injected anomalies through the store API", () => {
    const store = new SandboxStore(dataset);
    let acted = 0;

    for (const quote of store.listQuotes({ notFollowedUp: true, limit: 100 }).items) {
      const deal = store.getDeal(quote.dealId);
      const contact = store.getContact(deal.contactId);
      if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) continue;
      store.followUpQuote({ quoteId: quote.id, body: "Checking in on your quote. Any questions?" });
      acted++;
    }
    for (const deal of store.listDeals({ staleDays: 14, limit: 100 }).items) {
      store.updateDeal({ dealId: deal.id, nextAction: { summary: "Call to re-engage", dueOn: store.today() } });
      acted++;
    }
    for (const payment of store.listPayments({ unmatched: true, limit: 100 }).items) {
      const anomaly = dataset.anomalies.find((a) => a.kind === "unmatched-payment" && a.recordIds[0] === payment.id);
      const invoiceId = anomaly?.recordIds.find((id) => id.startsWith("inv_"));
      if (!invoiceId) continue;
      try {
        store.matchPayment({ paymentId: payment.id, invoiceId });
        acted++;
      } catch {
        // Ground truth may point at an invoice the payment cannot legally settle; the audit log records it.
      }
    }

    expect(acted).toBeGreaterThan(0);
    const audit = store.audit();
    expect(audit.filter((e) => e.result === "ok").length).toBe(acted);
    expect(audit.map((e) => e.seq)).toEqual(audit.map((_, i) => i + 1));
    expect(store.emittedEvents().length).toBeGreaterThanOrEqual(acted);
    expect(store.listQuotes({ notFollowedUp: true, limit: 100 }).items.every((q) => {
      const c = store.getContact(store.getDeal(q.dealId).contactId);
      return !c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
    })).toBe(true);
    expect(store.listDeals({ staleDays: 14, limit: 100 }).items.every((d) => d.nextAction !== null)).toBe(true);

    store.reset();
    expect(store.snapshot()).toEqual(dataset);
  });
});
