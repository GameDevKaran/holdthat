/** Deterministic checklist transitions. Only an explicit confirmation completes work. */
export type StepStatus = 'pending' | 'started' | 'uncertain' | 'confirmed';
export type Phase = 'READY' | 'ACTIVE' | 'INTERRUPTED' | 'DONE';

export interface TemplateStep {
  readonly id: string;
  readonly title: string;
  readonly dependencies: readonly string[];
}

export interface Template {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly TemplateStep[];
}

export interface Step {
  id: string;
  title: string;
  dependencies: string[];
  status: StepStatus;
  evidence: string | null;
}

export interface DomainEvent {
  id: string;
  type: 'created' | 'started' | 'reported' | 'confirmation_proposed' | 'confirmed' |
    'interrupted' | 'resumed' | 'corrected' | 'invalidated' | 'reset' | 'completed';
  stepId?: string;
  message: string;
  /** Logical revision, not a claim about wall-clock time or observed physical work. */
  at: number;
}

export interface Session {
  id: string;
  templateId: string;
  revision: number;
  phase: Phase;
  steps: Step[];
  events: DomainEvent[];
  pendingConfirmation: { stepId: string; evidence: string; proposedAtRevision: number } | null;
}

type RevisionGuard = { expectedRevision?: number };
export type Command = RevisionGuard & (
  | { type: 'start' }
  | { type: 'report'; stepId: string; status: 'started' | 'uncertain' | 'confirmed'; evidence: string }
  | { type: 'confirm'; stepId: string }
  | { type: 'interrupt' }
  | { type: 'resume' }
  | { type: 'correct'; stepId: string; status: 'pending' | 'started' | 'uncertain'; reason: string }
  | { type: 'reset' }
);

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

function freezeTemplate(template: Template): Template {
  for (const step of template.steps) {
    Object.freeze(step.dependencies);
    Object.freeze(step);
  }
  Object.freeze(template.steps);
  return Object.freeze(template);
}

export const templates: readonly Template[] = Object.freeze([
  freezeTemplate({
    id: 'travel-packing',
    title: 'Pack an overnight bag',
    description: 'A small, low-risk packing checklist that distinguishes sorting from packing.',
    steps: [
      { id: 'choose-bag', title: 'Choose and open the overnight bag', dependencies: [] },
      { id: 'sort-clothes', title: 'Lay out the clothes for the trip', dependencies: ['choose-bag'] },
      { id: 'pack-clothes', title: 'Put the selected clothes in the bag', dependencies: ['sort-clothes'] },
      { id: 'pack-toiletries', title: 'Put the toiletry pouch in the bag', dependencies: ['choose-bag'] },
      { id: 'close-bag', title: 'Check the packed items and close the bag', dependencies: ['pack-clothes', 'pack-toiletries'] },
    ],
  }),
  freezeTemplate({
    id: 'craft-kit',
    title: 'Prepare a paper craft kit',
    description: 'Gather paper, stickers and coloured pencils without tools, heat or chemicals.',
    steps: [
      { id: 'open-pouch', title: 'Open an empty craft pouch', dependencies: [] },
      { id: 'choose-paper', title: 'Choose the paper and sticker sheets', dependencies: ['open-pouch'] },
      { id: 'pack-paper', title: 'Put the paper and stickers in the pouch', dependencies: ['choose-paper'] },
      { id: 'pack-pencils', title: 'Put the coloured pencils in the pouch', dependencies: ['open-pouch'] },
      { id: 'check-kit', title: 'Check the contents and close the craft pouch', dependencies: ['pack-paper', 'pack-pencils'] },
    ],
  }),
  freezeTemplate({
    id: 'desk-cable-kit',
    title: 'Organise a spare cable kit',
    description: 'Sort and pack loose, disconnected spare cables. No powered equipment is involved.',
    steps: [
      { id: 'open-case', title: 'Open an empty cable case', dependencies: [] },
      { id: 'sort-cables', title: 'Sort the loose, disconnected spare cables', dependencies: ['open-case'] },
      { id: 'label-cables', title: 'Label the sorted cable groups', dependencies: ['sort-cables'] },
      { id: 'pack-cables', title: 'Put the labelled cables in the case', dependencies: ['label-cables'] },
      { id: 'close-case', title: 'Check the contents and close the cable case', dependencies: ['pack-cables'] },
    ],
  }),
]);

/** The caller should supply a unique ID when persisting more than one session. */
export function createSession(templateId: string, id = `session-${templateId}`): Session {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) throw new DomainError('UNKNOWN_TEMPLATE', 'Choose an available checklist.');
  if (typeof id !== 'string' || !id.trim()) throw new DomainError('INVALID_ID', 'A session ID is required.');
  return {
    id,
    templateId,
    revision: 0,
    phase: 'READY',
    steps: template.steps.map((step) => ({ ...step, dependencies: [...step.dependencies], status: 'pending', evidence: null })),
    events: [{ id: `${id}:0:0`, type: 'created', message: `Selected ${template.title}. No work is confirmed.`, at: 0 }],
    pendingConfirmation: null,
  };
}

function clone(session: Session): Session {
  return {
    ...session,
    steps: session.steps.map((step) => ({ ...step, dependencies: [...step.dependencies] })),
    events: session.events.map((event) => ({ ...event })),
    pendingConfirmation: session.pendingConfirmation ? { ...session.pendingConfirmation } : null,
  };
}

function append(session: Session, type: DomainEvent['type'], message: string, stepId?: string): void {
  session.events.push({
    id: `${session.id}:${session.revision}:${session.events.length}`,
    type,
    ...(stepId ? { stepId } : {}),
    message,
    at: session.revision,
  });
}

function active(session: Session): void {
  if (session.phase !== 'ACTIVE') {
    throw new DomainError('INVALID_PHASE', session.phase === 'INTERRUPTED'
      ? 'Resume the checklist before reporting or confirming progress.'
      : 'Start an unfinished checklist before reporting or confirming progress.');
  }
}

function findStep(session: Session, stepId: string): Step {
  const step = session.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new DomainError('UNKNOWN_STEP', 'That step does not belong to this checklist.');
  return step;
}

function eligible(session: Session, step: Step): boolean {
  return step.dependencies.every((id) => session.steps.some((candidate) => candidate.id === id && candidate.status === 'confirmed'));
}

function requireEligible(session: Session, step: Step): void {
  if (!eligible(session, step)) {
    throw new DomainError('DEPENDENCY_UNCONFIRMED', 'Confirm the prerequisite steps first.');
  }
}

function requiredText(text: string, label: string): string {
  if (typeof text !== 'string' || !text.trim()) throw new DomainError('EVIDENCE_REQUIRED', `${label} is required.`);
  if (text.length > 2000) throw new DomainError('EVIDENCE_TOO_LONG', `${label} must be 2,000 characters or fewer.`);
  return text.trim();
}

function descendants(session: Session, id: string): Set<string> {
  const affected = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const step of session.steps) {
      if (!affected.has(step.id) && step.dependencies.some((dependency) => affected.has(dependency))) {
        affected.add(step.id);
        added = true;
      }
    }
  }
  affected.delete(id);
  return affected;
}

export function getResumeDecision(session: Session): { stepId: string | null; kind: 'clarify' | 'next' | 'complete'; message: string } {
  if (session.steps.every((step) => step.status === 'confirmed')) {
    return { stepId: null, kind: 'complete', message: 'Every checklist step has your explicit confirmation.' };
  }
  if (session.pendingConfirmation) {
    const step = findStep(session, session.pendingConfirmation.stepId);
    return { stepId: step.id, kind: 'clarify', message: `You reported: “${session.pendingConfirmation.evidence}”. Can you confirm that you finished “${step.title}”?` };
  }
  const unresolved = session.steps.find((step) => eligible(session, step) && (step.status === 'uncertain' || step.status === 'started'));
  if (unresolved) {
    return { stepId: unresolved.id, kind: 'clarify', message: `Did you finish “${unresolved.title}”, or is there still work to do? It is not confirmed.` };
  }
  const next = session.steps.find((step) => step.status === 'pending' && eligible(session, step));
  if (!next) throw new DomainError('INVALID_STATE', 'No eligible step remains; the checklist needs repair.');
  return { stepId: next.id, kind: 'next', message: `Next: ${next.title}.` };
}

/** Returns a new session; refused commands cannot mutate state or its event history. */
export function applyCommand(session: Session, command: Command): Session {
  if (command.expectedRevision !== undefined && command.expectedRevision !== session.revision) {
    throw new DomainError('STALE_REVISION', 'This checklist has changed. Reload it before updating progress.');
  }
  const next = clone(session);
  next.revision += 1;
  switch (command.type) {
    case 'start': {
      if (next.phase !== 'READY') throw new DomainError('INVALID_PHASE', 'This checklist has already started.');
      next.phase = 'ACTIVE';
      append(next, 'started', 'Checklist started. Physical completion still requires your confirmation.');
      break;
    }
    case 'report': {
      active(next);
      const step = findStep(next, command.stepId);
      requireEligible(next, step);
      if (!['started', 'uncertain', 'confirmed'].includes(command.status)) throw new DomainError('INVALID_STATUS', 'Use started, uncertain or reported complete.');
      if (step.status === 'confirmed') throw new DomainError('ALREADY_CONFIRMED', 'Use a correction to change an already confirmed step.');
      const evidence = requiredText(command.evidence, 'Your progress statement');
      if (next.pendingConfirmation && next.pendingConfirmation.stepId !== step.id) {
        throw new DomainError('PENDING_CONFIRMATION', 'Resolve the current completion proposal before reporting another step.');
      }
      step.evidence = evidence;
      if (command.status === 'confirmed') {
        step.status = 'uncertain';
        next.pendingConfirmation = { stepId: step.id, evidence, proposedAtRevision: next.revision };
        append(next, 'confirmation_proposed', `Reported complete; awaiting explicit confirmation: ${evidence}`, step.id);
      } else {
        step.status = command.status;
        next.pendingConfirmation = null;
        append(next, 'reported', `${command.status === 'started' ? 'Started' : 'Uncertain'}: ${evidence}`, step.id);
      }
      break;
    }
    case 'confirm': {
      active(next);
      const step = findStep(next, command.stepId);
      if (!next.pendingConfirmation || next.pendingConfirmation.stepId !== step.id) {
        throw new DomainError('NO_CONFIRMATION_PROPOSAL', 'Report completion for this specific step before confirming it.');
      }
      requireEligible(next, step);
      step.status = 'confirmed';
      append(next, 'confirmed', `You explicitly confirmed: ${step.title}. Evidence statement: ${next.pendingConfirmation.evidence}`, step.id);
      next.pendingConfirmation = null;
      if (next.steps.every((candidate) => candidate.status === 'confirmed')) {
        next.phase = 'DONE';
        append(next, 'completed', 'All checklist steps have explicit user confirmation.');
      }
      break;
    }
    case 'interrupt': {
      active(next);
      next.phase = 'INTERRUPTED';
      append(next, 'interrupted', 'Paused. Started, uncertain and proposed steps remain unconfirmed.');
      break;
    }
    case 'resume': {
      if (next.phase !== 'INTERRUPTED') throw new DomainError('INVALID_PHASE', 'Only a paused checklist can be resumed.');
      next.phase = 'ACTIVE';
      append(next, 'resumed', getResumeDecision(next).message);
      break;
    }
    case 'correct': {
      if (next.phase === 'READY') throw new DomainError('INVALID_PHASE', 'Start the checklist before recording corrections.');
      const step = findStep(next, command.stepId);
      if (!['pending', 'started', 'uncertain'].includes(command.status)) throw new DomainError('INVALID_STATUS', 'Corrections cannot confirm completion.');
      if (command.status !== 'pending') requireEligible(next, step);
      const reason = requiredText(command.reason, 'A correction reason');
      const affected = descendants(next, step.id);
      const previous = step.status;
      step.status = command.status;
      step.evidence = reason;
      append(next, 'corrected', `Changed ${previous} to ${command.status}: ${reason}`, step.id);
      for (const dependent of next.steps) {
        if (affected.has(dependent.id) && dependent.status !== 'pending') {
          const prior = dependent.status;
          dependent.status = 'pending';
          dependent.evidence = null;
          append(next, 'invalidated', `Previous ${prior} state needs rechecking because “${step.title}” was corrected.`, dependent.id);
        }
      }
      if (next.pendingConfirmation && (next.pendingConfirmation.stepId === step.id || affected.has(next.pendingConfirmation.stepId))) {
        next.pendingConfirmation = null;
      }
      if (next.phase === 'DONE') next.phase = 'ACTIVE';
      break;
    }
    case 'reset': {
      for (const step of next.steps) {
        step.status = 'pending';
        step.evidence = null;
      }
      next.phase = 'READY';
      next.pendingConfirmation = null;
      append(next, 'reset', 'Checklist reset. Previous reports and confirmations remain in the history.');
      break;
    }
    default:
      throw new DomainError('UNKNOWN_COMMAND', 'That action is not supported.');
  }
  return next;
}
