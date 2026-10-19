---
name: plan
description: Use before building anything non-trivial. Turns a request into a short written plan with a checkable definition of done, surfaced unknowns, and a reviewed approach. Use when the work touches several files, introduces new behavior, or is hard to undo.
---

# Plan

```
UNDERSTAND THE PROBLEM BEFORE PROPOSING A SOLUTION
```

The expensive failure is not bad code. It is good code that solves the wrong
problem, discovered late. Planning is how you make that failure cheap.

Skip this for reversible one-file changes with an obvious answer. Use it for
everything at medium rigor or above in `instructions/workflow.md`.

## 1. Understand the request

Restate the goal in your own words and name the user-visible outcome. If your
restatement and the request differ, resolve that now, before any code.

Separate what was asked from what you inferred. Inferences are where plans go
wrong, so mark them and confirm the load-bearing ones.

Ask when the answer is a product decision you cannot derive: what should happen
in this edge case, is this limit intentional, who is allowed to do this. Do not
ask about things you can find out by reading the code. Go read it.

## 2. Read the actual code

Never plan against a guess. Find the real path the change touches and read it.

Establish where the entry point is, which files own the behavior, what data
shape flows through, what already exists that you should reuse instead of
rebuilding, and what conventions the neighbors follow.

Check `docs/decisions.md` for anything already settled here. Re-opening a decided
question wastes a review cycle, and if you believe the decision is now wrong, say
so explicitly rather than quietly working around it.

On a greenfield area with no code to read, this step becomes proposing the shape
instead of discovering it. Say which conventions you are establishing and get
agreement, because the first version becomes the pattern everything else copies.

## 3. Consider more than one approach

For anything hard to undo, name at least two real options and say why you chose
one. Two real options, not one plus a strawman.

If a decision is one-way, or the approaches differ in cost or risk rather than
taste, put it in front of the developer before building. This is the cheapest
review that exists.

## 4. Write the plan

Short and concrete. If it exceeds a page, the work should be split.

```markdown
## Goal
One sentence. The user-visible outcome.

## Done when
- [ ] Checkable statement, not "works correctly"
- [ ] Include how each will be verified

## Approach
The chosen design in a few sentences, and why this one over the alternative.

## Changes
- `path/to/file`: what changes and why
- `path/to/other`: what changes and why

## Risks
What could break, what is hard to undo, and how it gets rolled back.

## Not doing
Explicitly out of scope, so it does not silently grow.

## Open questions
Blocking questions, marked as blocking.
```

The two sections people cut are the two that pay. **Not doing** is what stops a
two-file change from becoming a twelve-file change. **Done when** is what makes
completion checkable instead of a matter of opinion.

Always write Goal, Done when, Approach, and Not doing. Write the other three only
when they carry weight. A risk section reading "low risk" is noise, so cut it.

For work spanning multiple sessions, keep the plan in the repository so it
survives the conversation. Otherwise keep it in the reply.

## 5. Get approval, then sequence

Wait for approval. A plan is a proposal, and presenting one does not authorize
building it.

Then order the work so each step is independently verifiable and leaves the
project working. Do the riskiest unknown first, because that is where the plan
gets invalidated, and finding out early is the entire point.

Re-plan when reality disagrees with the plan. Say what changed and why rather
than forcing the original sequence through.

## Red flags

| The thought | The reality |
|---|---|
| "I basically know what they want" | Basically is where rework comes from. Restate it. |
| "I'll figure out the edges while coding" | Edges discovered while coding become design changes. |
| "Reading that file would take a while" | Less time than rebuilding against a wrong assumption. |
| "There's only one way to do this" | Then say so in one line. That is still the step. |
| "The plan is obvious, I'll just start" | Then it takes two minutes to write. |
| "I'll ask once I've made progress" | Blocking questions block now, not later. |
