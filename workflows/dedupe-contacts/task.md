---
id: dedupe-contacts
title: Merge duplicate contacts without merging look-alikes
difficulty: medium
systems: [crm]
toolsets: [crm]
est_steps: 10
---

# Merge duplicate contacts without merging look-alikes

Duplicate contacts split a customer's history across two records, so reminders go to stale addresses and nobody sees the full picture. Over-eager merging is worse: two different people become one. This task checks that an agent merges real duplicates (same person, same phone number, slightly different spelling) into the record linked to the customer account, and leaves distinct people with similar names alone.

## Prompt

Our CRM has some duplicate contacts: the same person entered twice, usually with a slightly different spelling or a different email but the same phone number. Please merge each duplicate into the original record, keeping the one that's linked to their {{customer}} account.

Be careful. We have plenty of different people who share a last name or a first name, and those are not duplicates. Only merge records that are clearly the same person. Don't create, delete or message anyone, and don't change anything else.

## What a good result looks like

- For every duplicate pair, exactly one record survives (merged with `crm_merge_contacts`). It stays linked to the {{customer}} account and keeps a valid email and phone.
- Leads, deals, messages, calls and tasks of the merged record now point at the survivor, so nothing references a contact that no longer exists.
- Every other contact still exists, including look-alikes that share a first or last name with a duplicate.
- No messages sent and no other records changed.
