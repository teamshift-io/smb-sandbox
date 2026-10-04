---
id: speed-to-lead
title: Reply to every lead nobody answered
difficulty: easy
systems: [crm, inbox]
toolsets: [crm, inbox]
est_steps: 8
---

# Reply to every lead nobody answered

The first business to reply usually wins the job. This task checks that an agent finds every inquiry that never got a response, sends one personal reply that speaks to what the person actually asked, marks the lead contacted, and gives ownerless leads an owner.

## Prompt

Today is {{today}}. A few new inquiries never got a reply, and that's costing us work. Please answer every lead nobody has responded to yet:

- Send the person a personal first reply by email to their message. Use their first name and respond to what they actually asked about.
- Make sure the lead shows as contacted.
- If nobody owns the lead, assign it to {{salesperson}}.

One reply per lead. Don't message anyone else, and don't change anything else.

## What a good result looks like

- Every lead with no first response gets exactly one outbound message to its contact (email preferred) that uses their first name and refers to their request: either what they asked about or at least two specific words from it.
- Each of those leads ends up `contacted` (or `qualified`) with `firstResponseAt` set. Messaging the contact through the sandbox does this automatically.
- Leads that had no owner are assigned to {{salesperson}}, and existing owners stay as they were.
- No messages to anyone else and no other changes.
