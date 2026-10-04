---
id: daily-owner-brief
title: Write the owner's daily brief with the right numbers
difficulty: medium
systems: [invoicing, phone, crm, inbox]
toolsets: [invoicing, phone, crm, inbox]
est_steps: 10
---

# Write the owner's daily brief with the right numbers

A morning brief is only useful if its numbers are right and it lists exactly what needs attention: no padding, nothing missing. This task checks that an agent pulls receivables, the call log and the sales pipeline together, computes the totals correctly (leaving out invoices an unapplied payment would cover), and sends one email to the owner without contacting a single customer.

## Prompt

Morning! It's {{ownerFirst}}. Today is {{today}}. Please put together my daily brief and email it to me at {{ownerEmail}}. I only want the things that need attention:

1. Overdue invoices: each invoice number with its balance, and the total dollars overdue. Leave out any invoice that a payment we've already received (but haven't applied yet) would cover, since that isn't really overdue.
2. Missed calls and voicemails nobody returned: who called, and how many there are.
3. {{Quote}}s at risk: ones we sent more than a week ago that never got a follow-up and have no decision yet (including ones that lapsed). List each number and amount, plus the total dollars at risk.

Just the one email to me. Don't contact any {{customer}}s or change anything in the system.

## What a good result looks like

- Exactly one email, to the owner's address, and no other messages.
- Overdue: every open or partially paid invoice past its due date is listed by number, except those an unapplied payment would cover (same amount, same {{customer}} when known, received after issue). Those must not appear. The total of the listed balances appears as a dollar amount (within $1).
- Missed calls: every unreturned missed call or voicemail is listed (caller name or number), and a line about missed calls states the count.
- {{Quote}}s at risk: every {{quote}} sent 7+ days ago with no follow-up and no decision is listed by number, and the total appears as a dollar amount (within $1).
- Nothing in the system changes besides that one outbound email.
