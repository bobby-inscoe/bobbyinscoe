# Working workflow

Use the user's ordinary language to choose the next step. No special command
or pasted prompt is required.

## Decide what work is authorized

- An idea or spec conversation calls for discovery and a reviewable spec. It
  does not start implementation unless the user asks to build.
- A request to build or fix authorizes reversible local changes needed for that
  result. Make routine implementation choices from the repository and proceed.
- Ask about unresolved product behavior or a choice that is hard to reverse.
  Continue independent work while waiting. Do not ask for commands, paths, or
  conventions you can inspect.
- Get explicit authorization for deployment, production or hosted writes,
  destructive data operations, and force pushes. Honor authorization already
  given for the named action.

## Implement

1. Find the owning code, callers, tests, and applicable instructions. Read the
   current behavior before changing it.
2. For a small, reversible change, edit directly. For a substantial change,
   write a short plan or use the ready spec. Follow `.agents/skills/plan/SKILL.md` when
   the user is still deciding what to build.
3. Make the smallest complete change. Preserve contracts and update affected
   callers, tests, and docs. Do not mix unrelated cleanup into the task.
4. Run the checks that cover the changed behavior. Inspect the output and exit
   code. Expand checks for changes that cross boundaries or affect data.
5. Compare the result with the original request or spec acceptance cases.
   Report the change, observed verification, and remaining risk.

Do not claim a check passed from an earlier session or from another agent's
summary. Do not weaken a test to clear a failure. A check that cannot run is a
reported limit, not a pass.

## Execute a ready spec

Read its decisions, acceptance cases, slice dependencies, and progress. Start
with the first unfinished slice whose dependencies are complete. If the request
is to deliver the feature, continue through the remaining slices and integration
unless a blocking product decision or external authorization is needed. Keep
the spec's progress current after verified work.

Parallel slices are an option, not a target. Run them in separate branches and
worktrees only when their contracts are settled, their owned paths do not
overlap, and each can be verified on its own. Finish and integrate the
foundation slice first. Give each worker the spec path, slice ID, allowed paths,
base commit, acceptance cases, and checks. Workers report commits and evidence;
one coordinator updates the spec, integrates results, resolves conflicts, and
runs combined checks. If those conditions do not hold, work sequentially.
Never have two workers edit the same spec or shared file concurrently.

For this repository, place additional worktrees beside the primary checkout in
`<primary-checkout>-worktrees/<slice-name>`. Check `git worktree list` first. Do
not overwrite an existing worktree or someone else's uncommitted changes.

## Review and handoff

Review meaningful logic, data, or boundary changes against the acceptance cases
and connected code. Use a separate reviewer when one is available and the risk
justifies it. A reviewer reports concrete findings rather than inventing work.

When stopping mid-feature, use `.agents/skills/handoff/SKILL.md` and record the exact
next slice, verified state, failed attempts, and open decisions. A new session
should be able to continue from repository files and Git state.
