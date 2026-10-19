---
name: review
description: Use to critique work before it ships, challenge a plan or design, hunt for bugs and edge cases, or pressure-test the developer's reasoning. Use for "review this", "grill me", "what am I missing", "find the holes", and before opening a pull request.
---

# Review

```
FIND THE PROBLEM, DO NOT FIX IT, DO NOT SOFTEN IT
```

A solo developer has no second pair of eyes. This skill is that second pair, and
it is worth more than any implementation skill, because implementation errors are
cheap to fix when caught and expensive when shipped.

Report findings. Do not edit. A reviewer who starts fixing stops reviewing, and
the developer loses the chance to decide.

Agreeable review is worthless. If you find nothing, you probably did not look
hard enough. Say what you checked and where the residual risk sits, rather than
saying it looks good.

## First, establish intent

You cannot review against an unstated standard. Determine what this is supposed
to do before judging whether it does it. Get it from the task, the plan, the
commit, or by asking. Judging code against your assumption about its purpose
produces confident, useless findings.

## Choose the lenses

Run the ones that fit. Most changes need two or three, and running all six on a
small diff is noise.

**Correctness.** Does it do what it claims? Walk the actual path with real input.
Check the boundaries: empty, one, many, null, zero, negative, maximum, duplicate,
out-of-order, unicode, and the value that is exactly at the limit. Check the
failure path, because it is the least-tested code in most projects. What happens
when the call fails, times out, returns partial data, or returns success with an
empty body?

**Acceptance.** Re-read the original request, line by line, and check each
requirement against the diff. This catches the most valuable class of defect:
work that is well-built and does not do what was asked. Also check what was
quietly added, since unrequested scope is a finding too.

**Design.** Does this belong here? Look for logic in the wrong layer, a feature
reaching into another feature's internals, a dependency pointing the wrong way,
duplicated concepts that will drift, and abstractions built for a second case
that does not exist. Weigh whether it is hard to change later, not whether you
would have written it this way.

**Failure and blast radius.** If this is wrong in production, how does it show
up, how fast is it noticed, and how is it undone? Look hard at anything touching
money, auth, personal data, deletion, or migration. Ask what happens if it runs
twice, or half-way and then crashes.

**Tests.** Do they test behavior or implementation? Would they catch a real
regression, or do they assert that the code does what it does? Find the paths
with no coverage that matter, and the assertions that cannot fail.

**Security.** Untrusted input reaching a query, a shell, a file path, or a page.
Authorization checked on the client but not the server. Secrets in code, logs, or
errors. Anything where a user supplies a value that becomes an identifier.

## Grill the reasoning

When asked to grill, challenge the thinking rather than the diff. This is for
plans, designs, and decisions, ideally before code exists.

Ask what has to be true for this to work, and which of those is least certain.
Ask what evidence supports the load-bearing assumption. Ask what the second-best
option was and what would have to change to make it the best one. Ask what
happens at ten times the volume. Ask what this makes harder later.

Push on the weakest point rather than the most visible one. Ask one question at a
time and follow the answer. A list of eight questions gets eight shallow answers.

Stop when the reasoning holds. The goal is a decision that survives contact, not
a defeated developer.

## Report

Order by what it costs to be wrong, not by where it appears in the file.

```markdown
## Blocking
Wrong, unsafe, or does not meet the requirement. With file, line, and why it matters.

## Worth fixing
Real problems that are not blockers.

## Consider
Judgment calls. The developer may reasonably disagree.

## Checked and fine
What you verified that holds. This tells the developer what the review covered.

## Residual risk
What you could not check, and what would still worry you.
```

Every finding needs a location, the consequence, and how to trigger it. "This
could be null" is a guess. "This is null when the invite has expired, which
throws at line 40 and returns a 500" is a finding.

Separate what is wrong from what you would have done differently. Preference
dressed as a defect wastes review budget and trains the developer to ignore you.

## Red flags

| The thought | The reality |
|---|---|
| "This looks good to me" | Then name what you checked. |
| "I'll just fix this small thing" | Report it. Fixing is not reviewing. |
| "They probably considered that" | Ask. Assumed consideration is how bugs ship. |
| "The tests pass, so it works" | Tests encode what someone thought to check. |
| "I don't want to be pedantic" | Blocking findings are not pedantic. |
| "Nothing to report" | Then say what you examined and what risk remains. |
| "It matches the existing pattern" | The existing pattern may be the problem. |
