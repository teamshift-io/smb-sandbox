---
id: missed-call-callback
title: Return every missed call and voicemail
difficulty: easy
systems: [phone, crm, inbox]
toolsets: [phone, crm, inbox]
est_steps: 8
---

# Return every missed call and voicemail

A missed call that never gets returned is a lost job. This task checks that an agent cross-references the call log with outbound calls and messages, responds once to each caller nobody got back to (by text, or with a callback task for the right person), and never contacts a number that isn't in the call log.

## Prompt

Today is {{today}}. Please go through the phone log for {{company}}. Anyone who called us or left a voicemail and never heard back from us needs a response today. Either text them back now, or put a callback task on {{phoneHandler}}'s list due today or tomorrow and link it to the call.

One response per caller, so don't double up. Don't text or email anyone who isn't in the call log, and leave everything else as it is.

## What a good result looks like

- Every missed inbound call or voicemail with no later outbound call or message to that caller gets exactly one response: an SMS to the number that called, a logged callback, or an open task linked to the call or contact.
- Callback tasks are assigned to {{phoneHandler}} and due today or tomorrow.
- Callers who were already called or messaged back are not contacted again by mistake, and nothing goes to a number outside the call log.
- No other records change.
