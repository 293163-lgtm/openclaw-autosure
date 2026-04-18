## Autosure Professional Closure (TIMESTAMP)

- Scope: run_id `<RUN_ID>` project `<PROJECT>`.
- Round result: `<success|partial|failed|halted>`.
- Resume governance:
  - maxAutoResumes: `<N>`
  - cooldownMs: `<MS>`
  - circuit state: `<closed|open|half-open>`
- Current risk register:
  - P1: `<critical blocker or none>`
  - P2: `<degradation risk or none>`
- Evidence summary:
  - latest interruption reason: `<reason>`
  - dedupe/circuit decision: `<decision>`
  - latest resume action: `<action>`
- Next action:
  - `<single most important next step>`
- Recovery condition (if blocked):
  - `<what must be true to continue safely>`
