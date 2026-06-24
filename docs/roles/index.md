# Roles

Use this folder for reusable role cards and owner views.

Role cards should define:

- authority class
- default read scope
- default write scope
- expected evidence
- stop condition
- escalation or owner route

Runtime role launches, run packets, and role outputs stay under `.ai-control/`
until an owner accepts a compact result into `docs/`.
