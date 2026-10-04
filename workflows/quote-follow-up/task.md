---
id: quote-follow-up
title: Follow up on quotes that slipped through the cracks
difficulty: easy
systems: [crm, inbox]
toolsets: [crm, inbox]
est_steps: 8
---

# Follow up on quotes that slipped through the cracks

Sales follow-up is where small businesses leak the most revenue: a quote goes out, nobody chases it, and it quietly expires. This task checks that an agent finds exactly those quotes, writes one personal note per quote with the right number and amount, records the follow-up, and leaves everything else alone.

## Prompt

Hi, it's {{ownerFirst}}. Today is {{today}}.

Can you go through our {{quote}}s and chase the ones that slipped through the cracks? Anything we sent more than a week ago that never got a follow-up and still has no answer (including ones that have already lapsed) should get one short, friendly email to the {{customer}} we sent it to. Use their first name, mention the {{quote}} number and the total, and offer to answer questions. For lapsed ones, offer to refresh it. Log the follow-up on the {{quote}} wherever the system lets you.

One email per {{quote}}, please, no doubles. Leave anything that's been accepted or declined alone, and don't change anything else.

## What a good result looks like

- Every {{quote}} sent 7+ days ago with no follow-up and no decision (sent, viewed or expired) gets exactly one email to the deal's contact.
- Each email uses the contact's first name and states the {{quote}} number and its exact total.
- Open (sent/viewed) {{quote}}s show the follow-up in their `followUps` history (`crm_follow_up_quote` does both at once). Expired ones can't be logged, so an email linked to the {{quote}} is enough.
- No emails about accepted, declined, recent or already-followed-up {{quote}}s, and no other records change.
