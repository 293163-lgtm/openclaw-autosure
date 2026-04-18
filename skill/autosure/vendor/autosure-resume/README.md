# autosure-resume

Bounded auto-resume plugin for OpenClaw sessions.

## What it adds over basic auto-resume

- session phase tracking (`idle/running/waiting_resume/resumed_recently/open_circuit/half_open`)
- dedupe fingerprints with TTL
- circuit breaker with half-open probing
- compression-aware waiting windows
- bounded retries (`maxAutoResumes`)
- `/autosure` (no number) = unlimited loop injects until `/autosure stop` or a normal user message clears the loop
- `/autosure N` loop mode for the current session (N capped by `commandMaxRounds`, default very high)

## Key config

```json
{
  "plugins": {
    "entries": {
      "autosure-resume": {
        "enabled": true,
        "config": {
          "maxAutoResumes": 1,
          "cooldownMs": 15000,
          "compressionWaitMs": 60000,
          "circuitThreshold": 3,
          "circuitOpenMs": 120000,
          "dedupeTtlMs": 120000,
          "enableNonActionResume": false,
          "commandMaxRounds": 1000000,
          "demoInjectRounds": 2,
          "loopIdleGraceMs": 15000
        }
      }
    }
  }
}
```

## Session commands

- `/autosure-demo` - in-chat visual demo: assistant intro (via `before_dispatch`), then `demoInjectRounds` synthetic user turns using `skills/autosure/发动词.txt` rotation (same injection path as loop mode)
- `/autosure` - same idle-wait inject as `/autosure N`, but **no round cap** (stop with `/autosure stop` or send a normal user message)
- `/autosure 10` - after each successful assistant turn, wait `loopIdleGraceMs` (default 15000): if **no user message** arrives in that window, inject one phrase from `发动词.txt` and start the next turn; any inbound user message cancels the pending inject for that round. Loop inject does **not** instruct the model to shorten replies (distinct from `/autosure-demo` short-reply demo).
- `/autosure10` - same as `/autosure 10` (space optional between command and number)
- `/autosure status` - query loop status (target/completed/remaining)
- `/autosure stop` - stop loop immediately in current session

## Safety defaults

- only one auto-resume per interruption chain
- cooldown + dedupe prevent message storms
- repeated failures open circuit and pause scheduling
