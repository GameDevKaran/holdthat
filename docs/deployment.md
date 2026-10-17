# Deployment and operations

No public deployment or AWS verification has occurred. The application is runnable locally and has a container configuration. Use one instance with persistent local storage; SQLite is not a shared multi-replica database.

## Local release

Use Node 24 and the committed lockfile:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3210. Default mode makes no model calls. Optional configuration is read from the ignored .env.local file. Do not copy the entire private portfolio master file here; choose only this app's allowlisted variables.

## Container

```sh
docker build -t holdthat:local .
docker run --rm -p 127.0.0.1:3210:3210 -e NODE_ENV=development -v holdthat_data:/data holdthat:local
```

The image runs as the node user, stores SQLite under /data and includes an HTTP health check. Development mode in this local command permits loopback HTTP; production requires HOLDTHAT_ORIGIN to be the exact public HTTPS origin. No model secrets are baked into the image.

## Authorized HTTPS host

deploy/compose.yaml pairs the app with Caddy and a named persistent database volume. Supply HOLDTHAT_DOMAIN through the host's private configuration, point that approved hostname at the approved host, and allow inbound 80/443 for HTTPS issuance/traffic. The app port is internal to the compose network. Run Docker Compose from deploy only after the hosting account, network, DNS permission and spending scope are approved.

An AWS VM can run this same container pair. AWS provisioning, IAM permissions, DNS/TLS ownership and cost have not been verified or purchased. A provider-generated HTTPS reverse proxy can replace Caddy: preserve the public Host header, forward to port 3210 and set the exact HOLDTHAT_ORIGIN. Keep one replica and persistent /data. Do not use ephemeral serverless container storage while claiming durable checkpoints.

Do not mount a host AWS credentials directory into a public container. For AWS use a scoped workload role; for local authorized tests use AWS_PROFILE. Model invocation requires HOLDTHAT_MODEL_PROVIDER=bedrock, AWS_REGION or BEDROCK_REGION and an actual BEDROCK_MODEL_ID. Scope bedrock:InvokeModel to the chosen model/inference profile. Verify service/model availability before deployment.

## Live acceptance gate

1. Record approved account/profile, region, model, resource IDs and budget. No values are inferred from existing unrelated projects.
2. Build and pin the tested source/image. Check the exact public origin and Secure/HttpOnly/SameSite session cookie.
3. From a clean external browser, create/report/confirm/pause/reload/resume/correct/export/clear a session. A second browser must not read the first session.
4. Restart the application and verify the same browser recovers its persisted state.
5. If Bedrock is enabled, run an authorized actual request, retain sanitized request/model/usage evidence and verify model failure leaves state unchanged. Unit doubles do not satisfy this step.
6. Record source commit, live URL, image digest, access date and failure observations. Keep access through the event judging window.

## Limits, privacy and maintenance

Anonymous browser cookies act as session capabilities. There is no cross-device account recovery. Input is restricted to owned low-risk checklist examples; no medication, machinery, money or other high-stakes workflow is supported.

Seven-day-old unused sessions are removed at server startup; users can clear immediately. Backups should use SQLite's supported backup process or stop the app and copy the database plus its WAL/SHM files together. Encrypt backups, restrict access and keep their retention explicit. Do not upload raw session data as judging evidence.

Request limits are per-process; model daily/session counters reset on restart and are a development guard, not a billing guarantee. Apply provider budgets/quotas and an edge rate limit before enabling a public paid-model endpoint. A fresh browser can create a new session. Never describe these controls as preventing all paid-endpoint abuse.

Before update, save a compatible database backup and source/image reference. Deploy one replacement instance against the same volume, verify recovery, and revert to the previous image if it fails. Removing the container must not remove the named data volume. No automated cloud cleanup or recurring monitoring has been created.
