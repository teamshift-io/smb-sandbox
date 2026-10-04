---
id: overdue-invoice-reminders
title: Send overdue invoice reminders by the house rules
difficulty: medium
systems: [invoicing, crm, inbox]
toolsets: [invoicing, crm, inbox]
est_steps: 12
---

# Send overdue invoice reminders by the house rules

Chasing receivables sounds simple until a reminder goes to a customer who already paid. This task checks that an agent reminds only the invoices the policy says to chase, picks a contact it can actually reach, writes the exact balance, and routes "probably already paid" cases to the bookkeeper instead of the customer.

## Prompt

Today is {{today}}. Please send payment reminders for our overdue invoices. House rules:

- Only invoices that are still open or partly paid and at least 7 days past their due date.
- One reminder per invoice, to a contact at that {{customer}}. Use email if we have a working address for them, otherwise send a text.
- Every reminder states the invoice number and the exact balance still owed.
- If we've received a payment that looks like it covers the invoice but it was never applied, do not send a reminder. Create a task for {{bookkeeper}} to sort it out instead, linked to the invoice.
- Don't apply, record or void any payments or invoices yourself, and don't change anything else.

## What a good result looks like

- Every open or partially paid invoice 7+ days past due that isn't covered by an unapplied payment gets exactly one reminder (email, or SMS when the contact has no valid email) to a contact of the invoice's {{customer}}.
- Each reminder contains the invoice number and the balance to the cent (`invoicing_send_reminder` writes this by default).
- Past-due invoices that an unapplied payment would cover (same amount, same {{customer}} when known, received after the invoice was issued) get no reminder, plus an open task for {{bookkeeper}} linked to the invoice.
- No payments matched or recorded, no invoices voided, nothing else changed.
