---
id: reschedule-propagation
title: Make every moved appointment consistent everywhere
difficulty: hard
systems: [calendar, crm, inbox]
toolsets: [calendar, crm, inbox]
est_steps: 14
---

# Make every moved appointment consistent everywhere

When a job is moved on the calendar but the technician's task and the customer's confirmation still show the old time, somebody shows up on the wrong day. This task checks that an agent finds upcoming appointments whose tasks disagree with the calendar, fixes the task list, sends the customer the new day and time (following the company's messaging policy), and leaves past jobs and the calendar itself alone. When there is nothing upcoming to repair, the owner adds a booking request so the same propagation skills are still tested.

## Prompt

Today is {{today}}. When {{job}}s get moved on the calendar, the rest doesn't always follow: the assigned person's task still shows the old date, and the {{customer}} never hears about the change. Please check every upcoming {{job}} on the calendar and fix any where that happened:

- The calendar time is the correct one. Don't move any {{job}}s.
- Tasks can't be edited, so add a new task for the same person with the correct date, linked to the {{job}}, and mark the outdated task done.
- Send the {{customer}} an updated confirmation with the new day and time.

{{policyHint}}

{{bookingRequest}}

Leave {{job}}s that already happened alone, and don't change anything else.

## What a good result looks like

- For every upcoming scheduled {{job}} whose assignee task still shows the pre-reschedule date: the {{job}} keeps its calendar time, a new open task for the same assignee is due on the {{job}}'s local date and linked to it, no open task linked to that {{job}} still shows another date, and the {{customer}} gets a message naming the new day and time.
- Home-services: that message is a text, per the "Appointment changes" policy. Dental: texts never name the treatment, per the privacy policy.
- When the prompt includes a booking request: a new {{job}} for that {{customer}} at exactly the requested time with the named person, a task for them that day linked to it, and a confirmation naming the day and time.
- No messages about {{job}}s that already happened, and no other changes.
