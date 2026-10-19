# Public release — 19 October 2026

App: https://holdthat-kc4mxxrtbq-uc.a.run.app

Deployed source: `0e90b8984c35a912e4471d20a6c7c92adacb9745`.
Cloud Run revision: `holdthat-00004-sf4`.
Image digest: `sha256:4abbbe0653ccb723e6d51ec9f7647b810471e465fba616a4238313fd1746264c`.

Verified against the actual service:

- Anonymous public HTTPS and desktop/mobile Chromium workflow: choose a checklist, report completion, explicitly confirm, report unfinished work, pause, reload, resume and delete.
- Actual Streamable HTTP MCP initialization, four tools and report execution. A completion report stays uncertain until separate confirmation.
- Real GCS persistence across a new Cloud Run revision, export and deletion.
- Separate browser owner isolation, Secure/HttpOnly/SameSite cookies and rejection of hostile origins.

The release source passed 50 Node tests and 20 browser scenarios before deployment. Failure injection and generation-race tests use test doubles; live evidence above uses real GCP. The first public browser run clicked before resume finished. The verifier now waits for the enabled resumed-state control; the final complete public run passed. No application rewrite or redeployment was needed for that test synchronization correction.

Sanitized operator reports and screenshots are in ignored `.local/live/`; private probe cookies are never release assets. The reproducible verifier is `scripts/verify-live.ts`. Its `prepare` and `restart` phases require a separately replaced revision; do not rerun them merely to recreate existing evidence.

The live experience is explicitly an Alexa+ simulation with real MCP. No native Alexa device connection, live Bedrock inference, physical microphone test or user study is claimed. Optional model code remains disabled. Public video upload and Devpost submission belong to the entrant and are not completed by this release.

## Ninety-second demonstration

1. Open the public URL in a clean browser; identify the simulation label and real MCP connection.
2. Choose the overnight bag. Report “The bag is open” as finished; show that the count stays at zero.
3. Explicitly confirm. Show one confirmed step.
4. Report “I started sorting clothes” as started, then pause and reload.
5. Resume; point out that sorting is still unfinished and the confirmed bag step remains intact.
6. Show checkpoint history and export. Explain that the state survived an independently verified server revision replacement.
7. Close with the boundary: MCP and cloud persistence are live; AI interpretation and native Alexa are not enabled.

Use `README.md` for setup and `docs/cloud-run.md` for isolation, expiry and rollback. Keep the public service available during judging.
