---
id: stale-deal-next-actions
title: Give every stalled deal a concrete next step
difficulty: easy
systems: [crm]
toolsets: [crm]
est_steps: 8
---

# Give every stalled deal a concrete next step

A pipeline where half the deals have no next step, or a next step from last season, is a forecast nobody can trust. This task checks that an agent finds every open deal that's missing a next action, has an overdue one, or hasn't moved in two weeks, sets a specific next action due within a week, and doesn't touch closed deals, stages or amounts.

## Prompt

Today is {{today}}. Please go through every open deal in our pipeline. Any deal that has no next step, has a next step that's already overdue, or hasn't had any activity in the last 14 days needs a concrete next action (what exactly happens, and with whom) due within the next 7 days.

Don't touch won or lost deals, don't change stages or amounts, and don't contact anyone yet. This is just CRM cleanup.

## What a good result looks like

- Every open deal (not won or lost) with no `nextAction`, a `nextAction` due before today, or no update in 14+ days ends up with a `nextAction` due between today and 7 days from today.
- Each summary is specific (at least three words, e.g. "Call Dana to get a decision on Q-1042"), not "follow up".
- Those deals stay open with the same stage and amount, won and lost deals are untouched, and no messages go out.
