---
name: diagnose
description: Use when something is broken, failing, flaky, slow, or behaving unexpectedly, including production incidents. Finds the root cause with evidence before any fix is proposed. Use for bugs, test failures, regressions, performance problems, and outages.
---

# Diagnose

```
NO FIX WITHOUT A ROOT CAUSE YOU CAN POINT AT
```

A fix applied to a symptom you do not understand is a guess. It sometimes hides
the bug instead of removing it, which is strictly worse than not fixing it,
because now it fails later and somewhere else.

You are done investigating when you can say: this input reaches this line, which
does this wrong thing, which produces the symptom. Anything less is a hypothesis.

Once you know the cause, the fix follows the normal rigor dial in
`instructions/workflow.md`. A one-line fix in one file you just do. A fix that
changes a contract, a schema, or several files gets planned first with
`skills/plan.md`. Understanding the bug does not authorize a large change.

## If production is down, stabilize first

Stop the bleeding before you understand it. Roll back, disable the flag, or fail
over, then investigate with the pressure off.

Say clearly that you mitigated rather than fixed. A mitigated incident is still
an open bug, and the root cause work below still has to happen. Skipping it is
how the same outage happens twice.

## 1. Reproduce it

An unreproduced bug is a story. Get it failing on demand before changing
anything, because a reliable reproduction is also how you will know you fixed it.

Nail down the exact steps, the environment, and how often it happens. If it is
intermittent, find what varies between runs. Intermittent almost always means
time, ordering, concurrency, caching, or leftover state.

If you cannot reproduce it, say so and switch to narrowing: what is different
between where it fails and where it does not. Do not proceed to a fix on a bug
you have never seen.

## 2. Read the error properly

Read the whole error and the whole stack trace, oldest frame first. Note the
exact file, line, and message.

The error frequently states the answer. Skimming it and pattern-matching to a
familiar-looking bug is the most common way to waste an hour.

## 3. Find the root cause

Trace backwards from the failure toward the origin. Where does the bad value
first appear, and where did it come from?

Form one hypothesis at a time, stated so it can be wrong: "the cache returns a
stale record because it is keyed without the tenant." Then run the cheapest check
that could disprove it. Change one thing at a time, and if a change does not
teach you something, revert it.

Ask what changed. Recent commits, dependency updates, configuration, and data
volume cause most new failures. `git log` and `git bisect` beat reasoning here.

Keep asking why until you reach something structural. The null check is missing,
but why was the value null, and why did nothing prevent that. Stopping at the
first answer produces the null check. Continuing produces the fix.

## 4. Fix the cause

Make the smallest change that removes the root cause. Resist fixing nearby things
you noticed, because it destroys the signal about what actually fixed the bug.
Note them separately.

Then write the regression test and verify it in both directions. Run it against
the unfixed code and watch it fail. Restore the fix and watch it pass. A
regression test you never saw fail proves nothing.

Prevention closes the loop. If this class of bug can recur, ask what makes that
impossible: a type, an assertion, a lint rule, a check at the boundary. A test
catches this bug. Structure catches the whole family.

## 5. Report

```markdown
## Symptom
What was observed, and how to reproduce it.

## Root cause
The specific mechanism. File and line. Why it produces the symptom.

## Evidence
What proves this is the cause, not a correlation.

## Fix
What changed and why this is the cause and not the symptom.

## Verification
The regression test, confirmed failing before and passing after.

## Prevention
What stops this class of bug, or explicitly none.

## Noticed but not fixed
Separate issues found on the way.
```

State your confidence honestly. "This is consistent with the symptom but I could
not reproduce the original failure" is a useful, respectable answer. A confident
wrong diagnosis is not.

## Red flags

| The thought | The reality |
|---|---|
| "I've seen this before, it's probably X" | Probably is a hypothesis. Check it. |
| "Let me try this and see if it helps" | That is guessing. Form a hypothesis first. |
| "It works now" | Do you know why? If not, it may return. |
| "Adding a null check fixes it" | Why was it null? That is the actual bug. |
| "It's flaky, I'll retry it" | Flaky means a real race you have not found. |
| "It's urgent, no time to investigate" | Guessing under pressure is slower. Mitigate, then investigate. |
| "The test is wrong" | Sometimes true. Usually the test is right. Prove it. |
| "It only happens in production" | Then production differs. Find how. |
