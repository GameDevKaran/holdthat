# HoldThat verification

Local verification completed on 16–17 October 2026 with Node 24.8.0, pinned dependencies and Chromium. The release commit is recorded in the private project checkpoint; no public deployment is claimed.

| Check | Observed result |
|---|---|
| TypeScript + Vite production build | Passed |
| Node tests | 36 passed: 20 domain, 7 model contract, 9 server/persistence/integration |
| Browser tests | 18 passed: 9 scenarios on desktop and mobile Chromium |
| Recovery evaluation | 20/20 synthetic states matched; [method and limits](recovery-evaluation.md) |
| Real local MCP | Initialize, tool discovery, report, interruption and resume over Streamable HTTP |
| SQLite persistence | Database reopen and local container restart retain the session |
| Linux container | Build and localhost health/session smoke test passed |
| HTTPS Compose configuration | Validated with a non-routable example domain; nothing provisioned |
| Dependency audit | No production vulnerabilities reported at verification time |

Tests cover explicit confirmation, prerequisites, correction propagation, stale revisions, idempotent retry, browser isolation, origin/host rejection, HTML escaping, typed fallback, unavailable speech support, model-off mode, interpretation review and provider failure. Model tests inject responses, including malformed output. Browser model scenarios visibly label their interpreter **TEST DOUBLE — no live inference**. These never establish a Bedrock request.

Reproduce with `npm ci`, `npm run build`, `npm test`, `npx playwright install chromium`, `npm run test:e2e`, and `node --import tsx scripts/evaluate-recovery.ts`. CI is prepared as a manual workflow; no hosted CI run is claimed.

The local captioned walkthrough is 74.44 seconds at 1440×1000, recorded from actual UI/MCP behavior. It is retained outside Git under `.local/demo/holdthat-local-demo.webm`. The repository includes its recording script. Public video upload has not occurred.

Still unverified: live Bedrock and independent dialogue evaluation, native microphone/dictation quality on hardware, public HTTPS deployment, remote browser/device compatibility, production load, formal accessibility conformance and human usability. Browser tests use Chromium emulation, not physical phones. No Alexa device connection exists. Rate counters are process-local safeguards, not a persistent financial limit; configure account spending controls before enabling a paid public interpreter.
