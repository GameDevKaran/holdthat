# HoldThat

Resume interrupted tasks from confirmed checkpoints.

## Status

This repository contains the initial product documentation. Application development has not started. There is no runnable application, measured benchmark or deployed service yet.

## Intended use

Someone packing a travel bag or preparing a craft kit gets interrupted and cannot remember whether the last substep was finished. Restarting an ordinary checklist can repeat work; confidently advancing can omit it. HoldThat records spoken checkpoints and reconstructs the next defensible action after an interruption.

## Planned workflow

The user selects one owned low-risk checklist, speaks progress, interrupts, then asks to resume. State is `READY → ACTIVE → CHECKPOINT_CONFIRMED → INTERRUPTED → UNCERTAINTY_RESOLVED → RESUMED → DONE`. “I started sorting the cables” is not equivalent to “the cables are packed.” The language model extracts proposed evidence and selects a clarification; deterministic transitions preserve the distinction between started, confirmed and uncertain steps. The user can correct a checkpoint and see downstream consequences.

## Development

Start with the behavior and boundaries in [Architecture](docs/architecture.md), then establish the fixtures and acceptance checks in [Verification plan](docs/verification-plan.md). Runtime versions, dependency installation, commands and deployment instructions will be added alongside working code. No installation command is available at this stage.

Keep credentials in local ignored files or the deployment secret store. Do not commit user data, provider tokens or private evaluation records.

## License

Original application code and these documents use the [MIT license](LICENSE). Future dependencies, models, datasets and media retain their own licenses and must be reviewed before inclusion.
