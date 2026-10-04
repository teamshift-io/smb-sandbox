---
id: invoice-job-mismatch
title: Fix invoices attached to another customer's job
difficulty: hard
systems: [invoicing, calendar, crm]
toolsets: [invoicing, calendar, crm]
est_steps: 12
---

# Fix invoices attached to another customer's job

An invoice linked to the wrong customer's job breaks job costing and confuses anyone who opens either record. This task checks that an agent compares each invoice's customer with the customer of its linked job, fixes only the mismatches using what the system allows (void and reissue when nothing is paid, otherwise a precise correction task for the bookkeeper), and leaves correctly linked invoices alone.

## Prompt

Some of our invoices are attached to a {{job}} that belongs to a different {{customer}}. Please find every invoice where that happened and get it fixed:

- If the invoice has no payments on it, void it and reissue it to the same {{customer}} with the same line items, attached to their own {{job}}.
- If it has payments (those can't be voided), or something stops you from reissuing it as-is, don't void it. Create a task for {{bookkeeper}} to relink it instead, and link the task to the invoice and to the {{customer}}'s correct {{job}}.

Don't touch invoices that are linked correctly, don't record or apply payments, and don't contact any {{customer}}s.

## What a good result looks like

- Every invoice whose linked {{job}} belongs to another {{customer}} is fixed. An unpaid one is voided and replaced by a new invoice for the same {{customer}} and total, linked to one of that {{customer}}'s own {{job}}s. A paid one gets an open task for {{bookkeeper}} whose related records include the invoice and a {{job}} of the invoice's own {{customer}} (ideally the exact one it should point at).
- No invoice is left voided without a replacement. Invoices with a negative credit line (for example "Less deposit invoiced") can't be recreated through `invoicing_create_invoice`, so those take the task route.
- No tasks, voids or new invoices for correctly linked invoices, no payments, no messages.
