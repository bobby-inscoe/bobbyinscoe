---
name: diagnose
description: Find the cause of broken, slow, flaky, or surprising behavior before fixing it. Use for bug reports, failures, and regressions.
---

# Diagnose

Use when behavior is broken, slow, flaky, or surprising. Find the cause before
choosing a fix.

1. Capture the symptom, environment, and a reproduction when possible. Read
   the full error and trace the path from input to the wrong result.
2. Form a hypothesis that a cheap check could disprove. Inspect recent
   changes, callers, boundaries, and data flow. If reproduction is unavailable,
   narrow the conditions and state the uncertainty.
3. Fix the cause with the smallest complete change. For a non-trivial bug, add
   a regression check that would catch its return. Preserve error handling and
   validation when moving code.
4. Run the focused check and any broader checks the affected boundary needs.
   Report the root cause, evidence, fix, and remaining uncertainty.

For an active production incident, stabilize the service through an authorized
rollback or mitigation first, then investigate the cause. A mitigation is not a
completed fix. Use the normal spec or plan path if the repair changes a contract
or spans several independent steps.
