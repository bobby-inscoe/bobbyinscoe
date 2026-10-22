# Agent guide

This repository contains the Bobby Inscoe site. Treat the code and tracked docs
as the source of truth; a past conversation is not required to continue work.

## Start from the request

- For an idea, design discussion, or request to make a spec, use
  `.agents/skills/plan/SKILL.md`. Discuss the outcome before writing code. Ask only for
  product decisions the repository cannot answer. Save a spec under `specs/`
  when the idea is clear enough to review.
- For "build this", "let's go", or similar, look for a ready spec in `specs/`.
  If exactly one fits, follow it without asking for a starter prompt. If several
  fit, ask which one. If none fits, scope the request from the code and use a
  short plan when the change needs one.
- For a failure, use `.agents/skills/diagnose/SKILL.md`. For a requested review, use
  `.agents/skills/review/SKILL.md`. For interrupted work, use `.agents/skills/handoff/SKILL.md`.
- For any implementation, follow `instructions/workflow.md` and the relevant
  parts of `instructions/engineering.md`. Read `instructions/architecture.md` when
  placing code or changing a boundary. Read only the files the task needs.

A ready spec records a clear outcome. A request to implement it authorizes
reversible local work, including the checks and local commits needed to finish
it. Do not repeatedly ask to proceed. Keep external writes, deployments,
destructive data changes, and force pushes tied to explicit authorization.

## Repository boundaries

- Feature code belongs in `src/features/<feature>/`. The app composes features
  in `src/app/`. Features do not import another feature's internals.
- Use the existing route, UI, test, and import patterns before introducing a
  new one. Share code only when the shared concept is real and stable.
- For House Scanner app, collector, database, or hosted data work, also read
  `instructions/house-scanner.md` and the relevant README or migration. For
  schema work, start from `instructions/house-scanner-schema.md`.
- Keep private household data, credentials, and local planning notes out of
  tracked specs and commits.

Write plain, concrete prose. Never add AI attribution to commits or pull
requests. Report what changed, what you checked, and any material limit.

## Reuse in another repository

Copy this guide, `instructions/workflow.md`, and `.agents/skills/`. Also copy
`.claude/skills/` for Claude Code. Replace stack, commands, and architecture
examples with that repository's facts.
Keep domain rules such as `instructions/house-scanner.md` only where they apply.
