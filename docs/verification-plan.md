# HoldThat: verification plan

No tests or evaluations have run. The following are prospective acceptance targets, not results.

## Fixtures and acceptance

maintain 20 development dialogues and 20 held-out dialogues authored separately. Compare a last-task reminder and static checklist with HoldThat on correct resume state, unnecessary repeated steps, clarification count and unsupported completion claims. Target at least 18/20 correct recovery states and zero invented completions. Include “not yet,” abandoned steps, contradictory updates, stale sessions and noisy transcription; report actual denominators and failures.

## Demonstration to verify

0–20 show interrupted packing; 20–55 record partial progress; 55–85 interrupt and return; 85–115 clarify the uncertain action and resume; 115–135 correct one earlier statement; 135–150 show trace, result and limits.

## Result record

For each run, record the source commit, fixture version, runtime/provider versions, actual pass and failure counts, latency, cost where relevant, and limitations. Keep development and held-out inputs separate. Report negative findings; freeze the protocol before inspecting held-out results.

A release requires a functioning end-to-end workflow and a clean-session replay. Documentation, repository creation and HTTP availability alone do not establish application correctness.
