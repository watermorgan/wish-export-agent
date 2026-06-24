# Platform Boundary

`docs/` is Markdown authority.

`.ai-control/` is not authority. It may contain only derived state, runtime
state, raw process artifacts, candidates, and cache files.

Candidate output is not accepted state. Intake is not acceptance. Runner output
is only an evidence candidate until an owner accepts it through the Markdown
authority path.

## State Roots

```text
docs/                         accepted authority
.ai-control/derived/          derived current views
.ai-control/runtime/agents/   dynamic role run status
.ai-control/runtime/tasks/    dynamic task status
.ai-control/runtime/runs/     dynamic run status
.ai-control/runtime/returns/  normalized external returns
.ai-control/raw/              raw tool, run, or provider artifacts
.ai-control/candidates/       memory, evidence, current, or closeout candidates
.ai-control/cache/            disposable cache
```

`docs/memory/` stores accepted reusable memory. `.ai-control/raw/` stores raw
process material that may be deleted, normalized, or promoted only after owner
review.
