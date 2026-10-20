---
name: plan
description: Turn a feature idea or design discussion into a reviewable spec with acceptance cases and implementation slices. Use when the user asks to explore, plan, or spec a change.
---

# From idea to spec

Use this when the user brings an idea, asks to plan a feature, or wants to
explore options. The user should be able to speak normally. A command is not
required. A small, obvious fix needs no saved spec.

## Discover the outcome

Read the relevant code and current product behavior before proposing structure.
Ask one consequential product question at a time: who it serves, what must
happen, what should happen at the edge, and what is deliberately out of scope.
Answer technical questions from the repository rather than asking the user.
Offer real alternatives when they change the experience, cost, or reversibility.
Record decisions as they are made. Do not turn brainstorming into code.

Draft a spec when the desired behavior can be stated as checkable examples.
Use `Status: draft` while a blocking product decision remains or the user is
still comparing options. Mark it `ready` when the outcome and acceptance cases
are clear and no blocking question remains. State any non-blocking assumptions;
do not require a ceremonial approval. Do not mark a contested or speculative
decision ready just to begin implementation.

Save a substantial spec at `specs/<short-name>.md`:

```md
# <Feature>

Status: draft | ready | in progress | done

## Goal
What changes for the user, and why.

## Current behavior
The relevant behavior and paths observed in this repository.

## Acceptance cases
- Given <state>, when <action>, then <observable result>.
- Include an edge or failure case when it matters.

## Decisions and boundaries
Settled product and technical decisions, affected contracts, constraints,
and what this work will not do.

## Slices
| ID | Outcome | Depends on | Owned paths or boundary | Check | State |
| --- | --- | --- | --- | --- | --- |
| S1 | ... | none | ... | ... | pending |

## Open questions
Only unresolved questions; mark any that block implementation.

## Progress
The coordinator records integrated slices, observed checks, and the next step.
```

Keep a spec readable without its original conversation. Link to existing code
and docs rather than copying them. Do not put secrets, real household profiles,
or private planning data in a tracked spec.

## Shape the slices

Use one slice if one will do. Each slice should produce a checkable change with
a clear owner. Put contracts, schema, shared types, or other foundation work
first. Describe the boundary a later slice can rely on, then identify slices
that can run independently. Reserve app composition and combined checks for an
integration slice when several workers are involved.

Mark slices parallel only when their dependencies are complete, their file
ownership does not overlap, and neither has to guess the other's contract.
Shared files, migrations, route composition, and changing product decisions
usually make work sequential. Parallelism should shorten delivery without
creating merge debt.

The spec is the handoff to a new conversation. On "let's go", the next agent
reads the ready spec and `instructions/workflow.md`, then starts the next
eligible slice. It does not need a pasted implementation prompt.
