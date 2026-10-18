#requires -Version 7.0
<#
Default: print an offline deployment plan. -Inspect: read-only scoped preflight.
-Execute: private deployment, only after explicit spending authorization.
-Execute -Resume -Publish: publish that verified private deployment.
ApprovalReference records a real user decision; a string cannot grant permission.
#>
[CmdletBinding()]
param(
    [switch]$Inspect,
    [switch]$Execute,
    [switch]$Resume,
    [switch]$Publish,
    [string]$ApprovalReference = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'tough-melody-508008-p8'
$ProjectNumber = '564976398462'
$Account = 'cgkaransahu@gmail.com'
$Region = 'us-central1'
$Service = 'holdthat'
$Bucket = 'tough-melody-508008-p8-holdthat-sessions'
$BucketUri = "gs://$Bucket"
$RuntimeIdentity = "holdthat-runtime@$Project.iam.gserviceaccount.com"
$RegistryHost = "$Region-docker.pkg.dev"
$ImagePath = "$RegistryHost/$Project/holdthat-images/holdthat"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$JournalPath = Join-Path $RepoRoot '.local/cloud-run-deployment.json'
$ProtectedNames = @('audiencegraph-web', 'greenlight', 'production-control-0909-01a085')
$Journal = $null

if (($Resume -or $Publish) -and -not $Execute) { throw '-Resume and -Publish require -Execute.' }
if ($Inspect -and $Execute) { throw 'Choose read-only -Inspect or -Execute, not both.' }
if ($Publish -and -not $Resume) { throw 'Publishing requires -Resume of this checkout deployment journal.' }

if (-not $Inspect -and -not $Execute) {
    @"
HoldThat plan only; no files, accounts or resources changed.
Project: $Project ($ProjectNumber), account: $Account, region: $Region
New resources: Cloud Run holdthat; runtime identity $RuntimeIdentity;
private bucket $Bucket; dedicated Docker registry holdthat-images.
Storage: GCS session objects with generation preconditions; no SQLite cloud volume.
Runtime: request-based CPU, min 0/max 1, 1 vCPU, 512 MiB, concurrency 16, timeout 30s.
Model: disabled. No AWS credentials, keys, secrets, Cloud Build or new APIs.
Execute first tests the clean committed checkout, locally builds/smoke-tests Docker,
creates isolated resources, uploads that image, deploys privately, reads its HTTPS
URL and configures that exact origin. Record private live verification before the
separate publish invocation. No existing project applications are modified.

Read-only preflight: ./deploy/gcp.ps1 -Inspect
After actual spending approval: ./deploy/gcp.ps1 -Execute -ApprovalReference '<decision reference>'
Resume an interrupted run: add -Resume and the same actual approval reference.
After private live verification: add -Resume -Publish to the approved invocation.
Spending is NOT authorized by this plan, an approval-reference string or max-instances.
"@
    return
}

function Invoke-Gcloud {
    param([Parameter(Mandatory)][string[]]$Arguments)
    # No global project/config mutation. Every invocation is explicitly scoped.
    $result = & gcloud @Arguments "--project=$Project" "--account=$Account" --quiet
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments[0..([Math]::Min(2,$Arguments.Length-1))] -join ' ')" }
    return ($result -join "`n")
}
function Invoke-Local {
    param([Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @())
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}
function Get-Services {
    return @(ConvertFrom-Json -InputObject (Invoke-Gcloud @('run','services','list',"--region=$Region",'--format=json')) -AsHashtable)
}
function Get-ProtectedSnapshot {
    param([array]$Services)
    $snapshot = @()
    foreach ($name in $ProtectedNames) {
        $entry = @($Services | Where-Object { $_.metadata.name -eq $name })
        if ($entry.Count -ne 1) { throw "Protected service missing or ambiguous: $name. Stop and investigate; do not recreate it." }
        $item = $entry[0]
        $specJson = ConvertTo-Json -InputObject $item.spec -Depth 50 -Compress
        $specHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($specJson)))
        $snapshot += @{ name = $name; specHash = $specHash; revision = $item.status.latestReadyRevisionName; url = $item.status.url }
    }
    return $snapshot
}
function Assert-ProtectedUnchanged {
    $current = Get-ProtectedSnapshot (Get-Services)
    foreach ($previous in $Journal.protected) {
        $now = @($current | Where-Object { $_.name -eq $previous.name })[0]
        if ($now.specHash -ne $previous.specHash -or $now.revision -ne $previous.revision -or $now.url -ne $previous.url) {
            throw "Protected service $($previous.name) changed since preflight. Stop; this script will not alter it."
        }
    }
}
function Save-Journal {
    $Journal.updatedAt = [DateTime]::UtcNow.ToString('o')
    $directory = Split-Path -Parent $JournalPath
    [void](New-Item -ItemType Directory -Path $directory -Force)
    $temporary = "$JournalPath.tmp"
    $Journal | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $JournalPath -Force
}
function Mark-Step {
    param([string]$Name)
    $Journal.steps[$Name] = [DateTime]::UtcNow.ToString('o')
    Save-Journal
}
function Read-Service {
    return ConvertFrom-Json -InputObject (Invoke-Gcloud @('run','services','describe',$Service,"--region=$Region",'--format=json')) -AsHashtable
}
function Assert-OwnedService {
    param([hashtable]$Item)
    if ($Item.metadata.labels.application -ne 'holdthat' -or $Item.spec.template.spec.serviceAccountName -ne $RuntimeIdentity) {
        throw 'HoldThat service identity/ownership does not match. Refusing to update it.'
    }
}

Push-Location $RepoRoot
try {
    [void](Get-Command gcloud -ErrorAction Stop)
    $projectInfo = ConvertFrom-Json -InputObject (Invoke-Gcloud @('projects','describe',$Project,'--format=json')) -AsHashtable
    if ($projectInfo.projectId -ne $Project -or [string]$projectInfo.projectNumber -ne $ProjectNumber -or $projectInfo.lifecycleState -ne 'ACTIVE') {
        throw 'Authorized project identity/state did not match. No fallback project is permitted.'
    }
    $billing = ConvertFrom-Json -InputObject (Invoke-Gcloud @('billing','projects','describe',$Project,'--format=json')) -AsHashtable
    if (-not $billing.billingEnabled) { throw 'Billing is not enabled on the authorized project. Do not change billing automatically.' }
    $apis = @(ConvertFrom-Json -InputObject (Invoke-Gcloud @('services','list','--enabled','--format=json')) -AsHashtable)
    foreach ($api in @('run.googleapis.com','artifactregistry.googleapis.com','iam.googleapis.com','storage.googleapis.com')) {
        if (-not @($apis | Where-Object { $_.config.name -eq $api }).Count) { throw "Required API $api is not enabled; no API is enabled automatically." }
    }
    # Inventory only the authorized project. A globally occupied bucket name makes
    # create fail; never inspect the bucket in another project to resolve a conflict.
    $services = Get-Services
    $protected = Get-ProtectedSnapshot $services
    $buckets = @(ConvertFrom-Json -InputObject (Invoke-Gcloud @('storage','buckets','list','--format=json')) -AsHashtable)
    $accounts = @(ConvertFrom-Json -InputObject (Invoke-Gcloud @('iam','service-accounts','list','--format=json')) -AsHashtable)
    $repositories = @(ConvertFrom-Json -InputObject (Invoke-Gcloud @('artifacts','repositories','list',"--location=$Region",'--format=json')) -AsHashtable)
    $exists = @{
        bucket = @($buckets | Where-Object { $_.name -eq $Bucket -or $_.name -eq $BucketUri }).Count -gt 0
        identity = @($accounts | Where-Object { $_.email -eq $RuntimeIdentity }).Count -gt 0
        registry = @($repositories | Where-Object { $_.name -eq "projects/$Project/locations/$Region/repositories/holdthat-images" }).Count -gt 0
        service = @($services | Where-Object { $_.metadata.name -eq $Service }).Count -gt 0
    }
    if ($Inspect) {
        @{ project = $Project; account = $Account; billingEnabled = $billing.billingEnabled; protected = $protected; namedResourcesAlreadyExist = $exists; spendingAuthorization = 'not inferred' } | ConvertTo-Json -Depth 10
        return
    }
    if ([string]::IsNullOrWhiteSpace($ApprovalReference) -or $ApprovalReference -match '^<|placeholder|pending') {
        throw 'Execution needs a reference to explicit user-approved spending. Record the real decision first; do not invent approval.'
    }
    [void](Get-Command docker -ErrorAction Stop)
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and verify the exact source checkout first. Uncommitted or untracked changes are not deployable.' }
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify the source commit.' }
    if ($Resume) {
        if (-not (Test-Path -LiteralPath $JournalPath)) { throw 'No local deployment journal. Existing resources cannot be silently adopted.' }
        $Journal = Get-Content -LiteralPath $JournalPath -Raw | ConvertFrom-Json -AsHashtable
        if ($Journal.project -ne $Project -or $Journal.service -ne $Service -or $Journal.commit -ne $commit -or $Journal.approvalReference -ne $ApprovalReference) {
            throw 'Resume scope/commit/approval differs from the journal. Review explicitly before changing it.'
        }
        foreach ($resource in $exists.Keys) {
            if ($exists[$resource] -ne $Journal.steps.ContainsKey("created-$resource")) { throw "Resource/journal mismatch: $resource. Inspect the last command; do not adopt or delete automatically." }
        }
        Assert-ProtectedUnchanged
        if ($exists.service) { Assert-OwnedService (Read-Service) }
    } else {
        if (Test-Path -LiteralPath $JournalPath) { throw 'A deployment journal exists. Use -Resume after review.' }
        foreach ($resource in $exists.Keys) { if ($exists[$resource]) { throw "Named $resource already exists. Refusing collision/reuse." } }
        $Journal = @{ project = $Project; service = $Service; commit = $commit; account = $Account; approvalReference = $ApprovalReference; protected = $protected; steps = @{}; createdAt = [DateTime]::UtcNow.ToString('o'); updatedAt = ''; public = $false }
        Save-Journal
    }

    if ($Publish) {
        if (-not $Journal.steps.ContainsKey('origin-configured')) { throw 'Complete the private deployment and its origin configuration first.' }
        # -Publish is an explicit operator action after private live verification.
        # This script records deployment mechanics, not application/competition completion.
        $deployed = Read-Service
        Assert-OwnedService $deployed
        $originEntry = @($deployed.spec.template.spec.containers[0].env | Where-Object { $_.name -eq 'HOLDTHAT_ORIGIN' })
        if ($originEntry.Count -ne 1 -or $originEntry[0].value -ne $Journal.url -or $deployed.status.latestReadyRevisionName -ne $Journal.revision) { throw 'The verified origin/revision changed. Reverify before publishing.' }
        [void](Invoke-Gcloud @('run','services','add-iam-policy-binding',$Service,"--region=$Region",'--member=allUsers','--role=roles/run.invoker'))
        $policy = ConvertFrom-Json -InputObject (Invoke-Gcloud @('run','services','get-iam-policy',$Service,"--region=$Region",'--format=json')) -AsHashtable
        if (-not @($policy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' -and $_.members -contains 'allUsers' }).Count) { throw 'Public invoker permission was not confirmed.' }
        $health = Invoke-RestMethod -Uri "$($Journal.url)/api/health" -TimeoutSec 30
        if ($health.status -ne 'ok' -or $health.application -ne 'holdthat') { throw 'Public health check failed. Follow rollback instructions; public release is not verified.' }
        Assert-ProtectedUnchanged
        $Journal.public = $true
        Mark-Step 'public-health-verified'
        Write-Output "Public HTTPS health verified: $($Journal.url). Full live E2E, persistence, demo and actual submission still need separate evidence."
        return
    }

    if (-not $Journal.steps.ContainsKey('local-image-tested')) {
        Invoke-Local node @('node_modules/typescript/bin/tsc','--noEmit')
        Invoke-Local node @('node_modules/vite/bin/vite.js','build')
        $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'tests') -Filter '*.test.ts' -File | ForEach-Object { $_.FullName })
        Invoke-Local node (@('--import','tsx','--test') + $testFiles)
        Invoke-Local node @('--import','tsx','scripts/test-browser.ts')
        $Journal.imageTag = 'git-' + $commit.Substring(0,12) + '-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
        $Journal.localImage = 'holdthat:release-' + $Journal.imageTag
        Invoke-Local docker @('build','--platform=linux/amd64','--tag',$Journal.localImage,'.')
        $container = 'holdthat-release-check-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
        try {
            Invoke-Local docker @('run','--detach','--rm','--name',$container,'--publish','127.0.0.1:3218:3210','--env','NODE_ENV=development','--env','HOLDTHAT_STORE=sqlite','--env','HOLDTHAT_MODEL_PROVIDER=none','--env','HOLDTHAT_ORIGIN=http://127.0.0.1:3218',$Journal.localImage)
            $healthy = $false
            for ($attempt=0; $attempt -lt 20; $attempt++) {
                try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3218/api/health' -TimeoutSec 2; if ($health.application -eq 'holdthat') { $healthy = $true; break } } catch { Start-Sleep -Milliseconds 500 }
            }
            if (-not $healthy) { throw 'Local container health failed; no upload or resources created.' }
            $bootstrap = Invoke-RestMethod -Uri 'http://127.0.0.1:3218/api/bootstrap' -TimeoutSec 10
            if ($bootstrap.model.enabled -or $bootstrap.templates.Count -lt 1) { throw 'Local container bootstrap/model-off verification failed.' }
        } finally {
            & docker stop $container | Out-Null
        }
        $Journal.localImageId = ((& docker image inspect $Journal.localImage --format '{{.Id}}') -join '').Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot record the tested image ID.' }
        Mark-Step 'local-image-tested'
    }
    if (-not $Journal.steps.ContainsKey('created-identity')) {
        [void](Invoke-Gcloud @('iam','service-accounts','create','holdthat-runtime','--display-name=HoldThat runtime','--description=Isolated HoldThat session object access only'))
        Mark-Step 'created-identity'
    }
    if (-not $Journal.steps.ContainsKey('created-bucket')) {
        [void](Invoke-Gcloud @('storage','buckets','create',$BucketUri,"--location=$Region",'--default-storage-class=STANDARD','--uniform-bucket-level-access','--public-access-prevention','--soft-delete-duration=0',"--lifecycle-file=$(Join-Path $PSScriptRoot 'gcs-lifecycle.json')"))
        Mark-Step 'created-bucket'
    }
    if (-not $Journal.steps.ContainsKey('bucket-configured')) {
        [void](Invoke-Gcloud @('storage','buckets','update',$BucketUri,'--no-versioning','--update-labels=application=holdthat'))
        [void](Invoke-Gcloud @('storage','buckets','add-iam-policy-binding',$BucketUri,"--member=serviceAccount:$RuntimeIdentity",'--role=roles/storage.objectUser'))
        $bucketInfo = ConvertFrom-Json -InputObject (Invoke-Gcloud @('storage','buckets','describe',$BucketUri,'--raw','--format=json')) -AsHashtable
        if ([string]$bucketInfo.projectNumber -ne $ProjectNumber -or $bucketInfo.iamConfiguration.publicAccessPrevention -ne 'enforced' -or -not $bucketInfo.iamConfiguration.uniformBucketLevelAccess.enabled) { throw 'Bucket project/privacy verification failed.' }
        if (($bucketInfo.ContainsKey('versioning') -and $bucketInfo.versioning.enabled) -or ($bucketInfo.ContainsKey('softDeletePolicy') -and [int64]$bucketInfo.softDeletePolicy.retentionDurationSeconds -gt 0) -or $bucketInfo.ContainsKey('retentionPolicy')) { throw 'Unexpected bucket retention/versioning may retain deleted sessions.' }
        Mark-Step 'bucket-configured'
    }
    if (-not $Journal.steps.ContainsKey('created-registry')) {
        [void](Invoke-Gcloud @('artifacts','repositories','create','holdthat-images',"--location=$Region",'--repository-format=docker','--description=HoldThat release images only','--labels=application=holdthat','--disable-vulnerability-scanning'))
        Mark-Step 'created-registry'
    }
    if (-not $Journal.steps.ContainsKey('image-uploaded')) {
        $currentImageId = ((& docker image inspect $Journal.localImage --format '{{.Id}}') -join '').Trim()
        if ($LASTEXITCODE -ne 0 -or $currentImageId -ne $Journal.localImageId) { throw 'Tested local image is missing or changed. No upload.' }
        $imageTagPath = "$ImagePath`:$($Journal.imageTag)"
        Invoke-Local docker @('tag',$Journal.localImage,$imageTagPath)
        # Scoped credential-helper environment; credentials are never printed or
        # exported to application env. Save and restore any prior local settings.
        $previousAccount = $env:CLOUDSDK_CORE_ACCOUNT
        $previousProject = $env:CLOUDSDK_CORE_PROJECT
        $previousDockerConfig = $env:DOCKER_CONFIG
        $dockerContext = (& docker context show).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the local Docker engine.' }
        $engineEndpoint = ((& docker context inspect $dockerContext --format '{{.Endpoints.docker.Host}}') -join '').Trim()
        if ($LASTEXITCODE -ne 0 -or $engineEndpoint -notmatch '^(npipe:|unix:)') { throw 'Only a local Docker engine may upload this tested image.' }
        try {
            $env:CLOUDSDK_CORE_ACCOUNT = $Account
            $env:CLOUDSDK_CORE_PROJECT = $Project
            $dockerConfig = Join-Path $RepoRoot '.local/gcp-docker'
            [void](New-Item -ItemType Directory -Path $dockerConfig -Force)
            $env:DOCKER_CONFIG = $dockerConfig
            [void](Invoke-Gcloud @('auth','configure-docker',$RegistryHost))
            Invoke-Local docker @('--host',$engineEndpoint,'push',$imageTagPath)
        } finally {
            $env:CLOUDSDK_CORE_ACCOUNT = $previousAccount
            $env:CLOUDSDK_CORE_PROJECT = $previousProject
            $env:DOCKER_CONFIG = $previousDockerConfig
        }
        $imageInfo = ConvertFrom-Json -InputObject (Invoke-Gcloud @('artifacts','docker','images','describe',$imageTagPath,'--format=json')) -AsHashtable
        $digest = $imageInfo.image_summary.digest
        if ($digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Cannot verify uploaded image digest.' }
        $Journal.image = "$ImagePath@$digest"
        Mark-Step 'image-uploaded'
    }
    if (-not $Journal.steps.ContainsKey('created-service')) {
        $environment = "NODE_ENV=production,HOST=0.0.0.0,HOLDTHAT_STORE=gcs,HOLDTHAT_GCS_BUCKET=$Bucket,GCP_PROJECT_ID=$Project,HOLDTHAT_MODEL_PROVIDER=none,HOLDTHAT_ORIGIN=https://holdthat-bootstrap.invalid"
        [void](Invoke-Gcloud @('run','deploy',$Service,"--region=$Region","--image=$($Journal.image)","--service-account=$RuntimeIdentity",'--port=3210','--min=0','--max=1','--min-instances=0','--max-instances=1','--cpu=1','--memory=512Mi','--concurrency=16','--timeout=30s','--cpu-throttling','--no-cpu-boost','--no-allow-unauthenticated','--ingress=all','--labels=application=holdthat',"--set-env-vars=$environment"))
        Mark-Step 'created-service'
    }
    if (-not $Journal.steps.ContainsKey('origin-configured')) {
        $deployed = Read-Service
        Assert-OwnedService $deployed
        $url = [string]$deployed.status.url
        if ($url -notmatch '^https://[a-z0-9.-]+\.run\.app$') { throw 'Unexpected service URL. Review before setting an origin.' }
        [void](Invoke-Gcloud @('run','services','update',$Service,"--region=$Region","--update-env-vars=HOLDTHAT_ORIGIN=$url"))
        $ready = Read-Service
        Assert-OwnedService $ready
        if (-not @($ready.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' }).Count) { throw 'Cloud Run revision is not ready.' }
        $Journal.url = $url
        $Journal.revision = $ready.status.latestReadyRevisionName
        Mark-Step 'origin-configured'
    }
    Assert-ProtectedUnchanged
    Write-Output "Private deployment prepared at $($Journal.url); model disabled. Verify real GCS persistence, MCP and browser behavior with authenticated requests. Then explicitly run -Execute -Resume -Publish using the same approval reference. This is not a submission/completion claim."
} finally {
    Pop-Location
}
