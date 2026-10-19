# HoldThat

Pick up an interrupted checklist from what you actually know.

HoldThat keeps started, uncertain and confirmed work separate. A completion report creates a review prompt; only an explicit confirmation completes the step. Correcting an earlier step preserves its history and reopens dependent work.

## Current behavior

- Three original low-risk checklists: overnight bag, paper craft kit and disconnected spare cable kit.
- Report progress, pause, reload, resume, clarify and correct it.
- Browser-bound private sessions persisted in Google Cloud Storage on the public service (SQLite locally), with export and deletion.
- Real browser MCP client and Streamable HTTP tools for progress, pause and resume.
- Optional browser dictation/read-aloud, with typed controls available.
- Optional Bedrock interpretation adapter, disabled by default and not yet live-verified.

**Try the public app:** https://holdthat-kc4mxxrtbq-uc.a.run.app

This is a labelled Alexa+ experience simulation, not a native Alexa connection. The deployed browser uses actual MCP tools and durable GCS sessions. Model interpretation is disabled; manual controls do not impersonate inference.

Verified 19 October 2026: public desktop/mobile workflow, explicit confirmation, pause/reload/resume, deletion, MCP, owner isolation, cross-origin rejection, export and progress surviving a Cloud Run revision replacement. Source release `0e90b8984c35a912e4471d20a6c7c92adacb9745`; 50 Node and 20 browser checks passed before deployment. See [release evidence](docs/live-release.md).

## Run

Requires Node 24.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3210. Configuration is optional for manual mode. Use .env.example as a names-only reference and an ignored .env.local for this app alone.

## Verify

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

The 20 domain cases assert independently specified progress/recovery outcomes. Additional tests cover actual local MCP calls, database reopening, retries, session isolation and injected model failures. Desktop and mobile Chromium workflows exercise the full UI. See [verification](docs/verification-plan.md) for exact results and limits.

## Design and operation

[Architecture](docs/architecture.md) · [Model boundary](docs/model-integration.md) · [Deployment](docs/deployment.md) · [Demo walkthrough](docs/demo.md)

HoldThat does not observe physical work. Its evidence is what the user reports and confirms. It is not suitable for medication, machinery, cooking heat, money movement or other high-stakes procedures. Sessions belong to one browser; clearing cookies loses access. Optional dictation may use the browser vendor's speech service.

## License

[MIT](LICENSE) for the application. Third-party packages retain their own licenses. No existing portfolio application code was reused.
