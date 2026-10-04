---
id: match-unmatched-payments
title: Apply unmatched payments to the right invoices
difficulty: hard
systems: [invoicing, crm]
toolsets: [invoicing, crm]
est_steps: 10
---

# Apply unmatched payments to the right invoices

A payment that isn't applied leaves an invoice looking unpaid, which leads to wrong reminders and wrong books. Forcing a payment onto the wrong invoice is just as bad. This task checks that an agent matches each unapplied payment by customer, amount and timing, and that when the records can't single out one invoice it flags the payment for a human instead of guessing.

## Prompt

We have payments in the system that never got applied to an invoice. Please match each one to the invoice it pays. It has to be the same {{customer}} if we know who paid, the exact amount still owed, and an invoice that was issued before the payment came in.

If you can't tell for sure which invoice a payment belongs to, don't guess. Leave it unapplied and create a task for {{bookkeeper}} explaining it, linked to the payment. Don't record new payments, void anything, or email anyone.

## What a good result looks like

- Every unapplied payment with exactly one plausible invoice (open or partially paid, balance equal to the payment, same {{customer}} when known, issued on or before the payment date) is matched to that invoice with `invoicing_match_payment`, which marks the invoice paid.
- A payment with several plausible invoices is either matched to the correct one or left unapplied with an open task linked to the payment. A wrong match fails.
- No payments recorded, no invoices voided or created, no messages sent.
