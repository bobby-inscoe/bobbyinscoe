---
name: handoff
description: Record verified progress and the exact next step when a spec or feature stops mid-work. Use when work is interrupted or another session must continue it.
---

# Handoff

Use when work stops before a spec or feature is complete. Record what the next
session cannot recover quickly from code and Git.

For a spec, the coordinator updates its `Progress` section after integration.
Workers do not edit the shared spec in parallel. A handoff should state:

- The exact next slice or action and its dependency state.
- What is integrated and verified, with commands and results.
- What is changed but unverified, including the branch or worktree.
- Decisions, failed approaches, and blocking questions.
- Relevant paths and the base or commit needed to resume.

Keep this concise. Reference files rather than pasting source or restating the
whole diff. If there is no tracked spec, put the handoff in the conversation;
create a file only when the work must survive another session. Never call
unverified work complete.
