# HoldThat: architecture

Proposed design; no components have been implemented.

The user selects one owned low-risk checklist, speaks progress, interrupts, then asks to resume. State is `READY → ACTIVE → CHECKPOINT_CONFIRMED → INTERRUPTED → UNCERTAINTY_RESOLVED → RESUMED → DONE`. “I started sorting the cables” is not equivalent to “the cables are packed.” The language model extracts proposed evidence and selects a clarification; deterministic transitions preserve the distinction between started, confirmed and uncertain steps. The user can correct a checkpoint and see downstream consequences.

Use a clearly labelled **Alexa+ experience simulation** with real agent tools. Planned stack: TypeScript web application, small relational event store, browser speech input/output and an authorized Amazon Bedrock text model selected at the access gate. The model handles ordinary speech and ambiguous completion language; it cannot invent physical completion or rewrite confirmed history. A static checklist provides the comparison baseline. No native Alexa device is required.

MVP: three authored checklists, one active session, pause/resume, clarification, correction and a visible evidence timeline. Exclude medication, cooking heat, machinery, financial actions, external reminders, calendar integration and multi-user surveillance. Use synthetic transcripts and consenting adult test recordings; delete raw audio by default after processing.

## Failure handling and data boundaries

Preserve original inputs and make unavailable evidence explicit. Provider failures must return a visible unresolved state. Decisions that change user or provider state need the confirmation specified above. Record source versions and operation identifiers without exposing credentials.

## Implementation record

Add pinned dependencies, actual component boundaries and operational instructions when the first working slice exists. Document departures from this design with their reason; do not describe planned integrations as verified.
