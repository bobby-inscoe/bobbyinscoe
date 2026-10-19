---
name: handoff
description: Use when a session is ending, running out of context, or being passed to another agent or person. Compresses the working state into a briefing that lets the next session resume without re-deriving anything. Use for "hand off", "write this up before we lose it", or a long session degrading.
---

# Handoff

```
WRITE WHAT THE NEXT SESSION CANNOT RECOVER FROM THE CODE
```

The code and the git history are already available to whoever comes next. The
handoff carries the part that dies with the conversation: what you tried, what
failed, what you decided, and what you were about to do.

Most handoffs fail by summarizing the diff, which the next session can read
faster than your description of it, while omitting the three dead ends that cost
two hours to discover.

## When

Do it when the session is long enough that you are losing earlier decisions, when
work is stopping mid-task, when passing to another agent or person, or when the
developer asks. Running out of context and continuing to degrade is worse than
stopping to write this.

## What to include

Ordered by value. If you write only the first three, the handoff still works.

**Where the work stopped.** The precise next action. Not "continue the migration"
but "the migration works for the first two tables, `orders` fails on the
timestamp column because the source is a string, and the next step is deciding
whether to cast in the query or in the mapper."

**What was decided and why.** Every choice the next session would otherwise
re-litigate. Include the rejected option and the reason, or it gets re-proposed
within ten minutes.

**What was tried and failed.** The highest-value section and the one most often
missing. Each dead end you record is time the next session does not spend
rediscovering it. Include why it failed, since sometimes it failed for a fixable
reason.

**The goal and its definition of done.** Restated, not referenced. The next
session may not have the original request.

**State of the work.** What is done and verified, done and unverified, and not
started. Keep those three separate. Unverified work presented as done is how
broken code ships.

**Open questions.** Especially anything blocked on the developer.

**Where to look.** Paths, symbols, commands. Point at files, do not paste them.

## Format

```markdown
# Handoff: <what this work is>
<date> · branch `<branch>`

## Goal
What we are trying to achieve. Done when: <checkable statements>.

## Status
Done and verified:
- item: how it was verified

Done, not verified:
- item: what still needs checking

Not started:
- item

## Next action
The specific next step, precise enough to act on immediately.

## Decisions
- Chose X over Y because Z.

## Tried and rejected
- Approach: why it failed.

## Open questions
- Question: blocking or not.

## Where to look
- `path/to/file`: what is there
- `command`: what it does
```

## Rules

Reference, do not copy. Paths and symbols, never pasted file contents. The next
session can read the repository, and a handoff full of source is a handoff nobody
finishes reading.

Be specific to the point of bluntness. "Auth is mostly working" tells the next
session nothing. Say which flows work, which fail, and how.

Never overstate. Mark unverified work as unverified. This is the single most
damaging thing a handoff can get wrong, because the next session builds on it.

Write it in the reply by default. Only write a file when the developer asks or
the work spans sessions, and never overwrite an existing handoff.

Then say plainly what remains uncertain. A handoff claiming everything is under
control, when it is not, wastes the next session's time in the most expensive
possible way.
