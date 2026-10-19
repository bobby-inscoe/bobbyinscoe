# AGENTS.md

Nine files. Two of them you edit per project, the rest work unchanged.

This file, together with `instructions/`, `docs/`, and `skills/`, holds the
shared operating rules for a solo developer and the AI agents working in this
repository. It is not a prompt library. It is the small set of files that keep
a human and an agent making the same decisions.

## For agents: read this first

**Always load** [`instructions/workflow.md`](instructions/workflow.md),
[`instructions/engineering.md`](instructions/engineering.md), and
[`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) before changing anything.
They override your defaults. Everything else loads on demand.

`workflow.md` is always in force. `engineering.md` is in force to the extent it
has been filled in, and its unfilled parts are questions for the developer rather
than permission to improvise. `unslop` is always in force for any prose you
write — it is a style rule, not a task route, so it does not wait for the table
below.

Route the current request by what it needs first:

| The request is | Start with |
|---|---|
| Build, change, or add something non-trivial | [`skills/plan/plan.md`](skills/plan/plan.md) |
| Something is broken, failing, or slow | [`skills/diagnose/diagnose.md`](skills/diagnose/diagnose.md) |
| Check, critique, or challenge existing work | [`skills/review/review.md`](skills/review/review.md) |
| This session is ending or getting expensive | [`skills/handoff/handoff.md`](skills/handoff/handoff.md) |
| A one-line change with an obvious answer | none, just do it, then verify |

Skills compose, in that order. "Fix this bug" starts at `diagnose.md`, and if the
fix turns out to be medium rigor or above, you plan it before building. Load the
second skill when you reach it, not up front.

Two reference documents, read when the question calls for them:

- [`docs/architecture.md`](docs/architecture.md) tells you where code goes and why.
- [`docs/decisions.md`](docs/decisions.md) tells you why something is the way it is
  before you argue it should be different.

If no skill fits, follow `workflow.md` directly. Do not invent a process.

If `instructions/engineering.md` still contains `FILL IN` markers, this system was
never adapted to this project. Say so and ask the developer for the ones your task
needs, usually the stack and the test command. Do not guess commands or invent
conventions from what you see in the tree.

## For the developer

You invoke skills by name in plain language: "plan this", "diagnose this",
"review this", "hand off". Nothing is a magic command, so this works on any
agent harness, today and after the tooling changes.

You never invoke verification. It is a gate in `workflow.md` that the agent owes
you on every task.

## Why the parts exist

**Instructions are the constitution.** Always loaded, project-specific, small.
They encode what is true about *this* repository: standards, boundaries, the
definition of done. An agent that reads nothing else should still not embarrass
you.

**Skills are the verbs.** Loaded on demand, portable across every project. They
encode *how* to do a kind of work well. They are project-agnostic on purpose, so
you can copy them into a new repository untouched. `unslop` is the one exception:
it is a style rule rather than a task route, so it is always loaded alongside
the instructions instead of waiting for a request to trigger it.

**Docs are the memory.** They answer questions that the code cannot: why this
shape, why not the obvious alternative. They exist because agents confidently
re-litigate settled decisions when nothing records them.

The split is the whole design. Project truth changes per repository and belongs
in instructions. Technique does not change and belongs in skills. History
accumulates and belongs in docs. When you are unsure where something goes, ask
which of those three it is.

## Adapting this to a new repository

1. Copy `AGENTS.md`, `instructions/`, `docs/`, and `skills/` into the new
   repository's root. Nothing in them imports anything, so it works
   immediately.
2. Fill the `FILL IN` markers in `instructions/engineering.md`. Budget twenty
   minutes. Wrong-but-specific beats vague, because you will correct it the first
   time an agent follows it badly.
3. Write the first three sections of `docs/architecture.md`. Leave the rest empty
   until the shape is real.
4. Leave `docs/decisions.md` empty. It earns its content.

Optional: if you also use a tool that doesn't yet read `AGENTS.md` natively
(for example, a harness that only looks for `CLAUDE.md` or
`.github/copilot-instructions.md`), point it here with a one-line file:

```markdown
See `AGENTS.md`.
```

## Maintaining it

Change a file when an agent gets something wrong twice. Once is noise. Twice is a
missing rule, and the fix goes in the layer that would have prevented it:

- It did the work wrong → `instructions/engineering.md`
- It followed a bad process → `instructions/workflow.md`
- It handled a whole class of work badly → the relevant skill
- It argued against a settled decision → `docs/decisions.md`

Two rules keep this from rotting into the thing it replaced.

**Prefer deleting.** If a rule has not changed an agent's behavior in months, it
is decoration. Remove it. This set of files should get denser over time, not
longer.

**Never add a file an agent will not open.** Before creating anything here, name
the request that would cause an agent to read it. If you cannot, the content
belongs inside an existing file or nowhere.

One more guard, because this is how these systems bloat. If a linter, formatter,
type checker, or test can enforce it, do that instead of writing it down here.
Prose rules are for judgment calls, and a mechanical rule written as prose is a
rule an agent can talk itself out of. Every line you move into tooling is a line
that enforces itself for free.

A realistic steady state is this set of files, slowly getting sharper. If you are
at thirty, something went wrong.
For House Scanner implementation, also read [docs/house-scanner.md](docs/house-scanner.md) and [docs/house-scanner-agents.md](docs/house-scanner-agents.md). Keep private planning data out of this repository.
