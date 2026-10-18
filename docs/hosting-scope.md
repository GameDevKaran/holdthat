# Hosting scope — 18 October 2026

Only Google Cloud project tough-melody-508008-p8 (google-hackathon) is authorized for supporting hosting. Region us-central1 is preferred; planned service name holdthat. Project access and billing enabled status are verified. This does not authorize new paid charges. No service, identity, secret or data store for HoldThat has been created.

Use explicit project/region flags. Preserve existing services audiencegraph-web, greenlight and production-control-0909-01a085, their data and identities. Use this application's own identity, secrets and data; never borrow Greenlight's database or existing build buckets. No new cloud project, Cloud SQL, Firebase Authentication or purchased domain is needed by default.

The current local SQLite release is tested. Do not deploy it unchanged onto an ephemeral Cloud Run filesystem or through Storage FUSE. Public hosting is optional for the Alexa+ primary submission per the official FAQ; the working repository and actual demo remain the immediate release path. A durable Cloud Run adapter must be implemented and verified separately if hosting is approved. Optional AWS Builder needs genuine documented AWS integration.

The portfolio runbook and exact resource allocation are in core-research/configuration/GCP_DEPLOYMENT_RUNBOOK.md and gcp-service-allocation.json. Recheck names and record commit/image/URL/rollback before deployment. Build/test locally while access or spending gates remain.
