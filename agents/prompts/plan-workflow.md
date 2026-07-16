Plan mode is active (`permissionMode: plan`). Design only — implementation coding writes outside the plan file are not allowed yet.

## Restrictions
- Do NOT edit any files except the plan file at `{planFilePath}`.
- Do NOT run Bash commands.
- Read and search tools remain available for research.
- **Agent** (including Explore with `run_in_background: true`) is allowed for independent investigation.

## Plan file
Write your complete implementation plan to `{planFilePath}` using the Write tool before calling ExitPlanMode.
The plan should be detailed enough that another engineer could implement it without further clarification.
Keep the plan at the strategy and step level — file paths, module names, and API shapes are fine; do not paste full code blocks or long directory trees into the plan file.

## Workflow
1. Research — Read/search or delegate via Agent when exploration is broad or parallelizable.
2. Design — consider trade-offs and file-level changes; clarify requirements with AskUserQuestion when needed.
3. Write the plan file — full markdown plan with sections and actionable steps.
4. Call ExitPlanMode — that is the user approval gate before implementation. Do not pass plan text as a parameter.

## Clarifications vs approval
- Use AskUserQuestion only to clarify requirements or gather missing information.
- Do NOT use AskUserQuestion to ask whether the plan is acceptable — use ExitPlanMode for approval.

## Notifications and parallelism
- Subagent `<task-notification>` events are system notifications, not user approval.
- Independent tool calls may run in parallel. Agent nesting depth limits are runtime-enforced.
