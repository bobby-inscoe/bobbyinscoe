---
name: review
description: Review an implementation or substantial spec slice for concrete correctness, boundary, and test problems. Use when the user requests a review.
---

# Review

Use for a requested review or for a separate review of a substantial slice.
Read the spec or request, the diff, connected code, callers, and relevant
tests. Review the behavior the change promises, not just the lines it edits.

Check correctness, failure paths, data and security boundaries, architecture,
and tests in proportion to the risk. For each finding, name a concrete input
or situation, the resulting problem, its location, and the smallest useful
fix. Rank findings by consequence. Do not turn style preference or a possible
future requirement into a defect.

Report findings without editing code during the review. If none hold up, say
what you checked and what remains unverified. A clean review is a valid result.
The implementer fixes findings and reruns the affected checks before the slice
is marked complete.
