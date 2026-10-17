import type { Command, Phase, StepStatus } from '../../src/domain/index.ts';

/** Authored development cases. These are not held-out evaluation results. */
export interface ProgressCase {
  name: string;
  commands: Command[];
  expected: {
    phase: Phase;
    kind: 'clarify' | 'next' | 'complete';
    stepId: string | null;
    states: Record<string, StepStatus>;
    proposal: string | null;
    invalidated?: string[];
  };
  refused?: Command;
  errorCode?: string;
}

const start: Command = { type: 'start' };
const pauseReturn: Command[] = [{ type: 'interrupt' }, { type: 'resume' }];
const complete = (...ids: string[]): Command[] => ids.flatMap((stepId) => [
  { type: 'report', stepId, status: 'confirmed', evidence: `I finished ${stepId}.` } as Command,
  { type: 'confirm', stepId } as Command,
]);
const all = ['choose-bag', 'sort-clothes', 'pack-clothes', 'pack-toiletries', 'close-bag'];

export const progressCases: ProgressCase[] = [
  {
    name: 'An untouched bag starts with the opening step and no completion claims',
    commands: [],
    expected: { phase: 'READY', kind: 'next', stepId: 'choose-bag', states: { 'choose-bag': 'pending', 'close-bag': 'pending' }, proposal: null },
  },
  {
    name: 'Starting to open a bag survives interruption as started, requiring clarification',
    commands: [start, { type: 'report', stepId: 'choose-bag', status: 'started', evidence: 'I have started opening the bag.' }, ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'started' }, proposal: null },
  },
  {
    name: 'Uncertain opening stays uncertain after leaving and returning',
    commands: [start, { type: 'report', stepId: 'choose-bag', status: 'uncertain', evidence: 'I cannot remember whether I opened it.' }, ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'uncertain' }, proposal: null },
  },
  {
    name: 'A spoken claim of finished opening proposes confirmation without completing it',
    commands: [start, { type: 'report', stepId: 'choose-bag', status: 'confirmed', evidence: 'The bag is open.' }],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'uncertain', 'sort-clothes': 'pending' }, proposal: 'choose-bag' },
  },
  {
    name: 'Explicitly confirming the opening unlocks clothes without repeating the bag step',
    commands: [start, ...complete('choose-bag'), ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'next', stepId: 'sort-clothes', states: { 'choose-bag': 'confirmed', 'sort-clothes': 'pending' }, proposal: null },
  },
  {
    name: 'Started sorting is never mistaken for packed clothes after interruption',
    commands: [start, ...complete('choose-bag'), { type: 'report', stepId: 'sort-clothes', status: 'started', evidence: 'I started sorting the shirts, but they are not packed.' }, ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'sort-clothes', states: { 'sort-clothes': 'started', 'pack-clothes': 'pending' }, proposal: null },
  },
  {
    name: 'An interrupted packing completion proposal waits for the same explicit acknowledgement',
    commands: [start, ...complete('choose-bag', 'sort-clothes'), { type: 'report', stepId: 'pack-clothes', status: 'confirmed', evidence: 'The clothes are in the bag.' }, ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'pack-clothes', states: { 'pack-clothes': 'uncertain', 'pack-toiletries': 'pending' }, proposal: 'pack-clothes' },
  },
  {
    name: 'Confirming the wrong step cannot consume an opening proposal',
    commands: [start, { type: 'report', stepId: 'choose-bag', status: 'confirmed', evidence: 'I opened the bag.' }],
    refused: { type: 'confirm', stepId: 'sort-clothes' }, errorCode: 'NO_CONFIRMATION_PROPOSAL',
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'uncertain', 'sort-clothes': 'pending' }, proposal: 'choose-bag' },
  },
  {
    name: 'Packing cannot start before the clothes selection prerequisite is confirmed',
    commands: [start],
    refused: { type: 'report', stepId: 'pack-clothes', status: 'started', evidence: 'I started packing.' }, errorCode: 'DEPENDENCY_UNCONFIRMED',
    expected: { phase: 'ACTIVE', kind: 'next', stepId: 'choose-bag', states: { 'choose-bag': 'pending', 'pack-clothes': 'pending' }, proposal: null },
  },
  {
    name: 'A bare confirmation with no completion proposal is refused',
    commands: [start],
    refused: { type: 'confirm', stepId: 'choose-bag' }, errorCode: 'NO_CONFIRMATION_PROPOSAL',
    expected: { phase: 'ACTIVE', kind: 'next', stepId: 'choose-bag', states: { 'choose-bag': 'pending' }, proposal: null },
  },
  {
    name: 'A second completion proposal cannot silently replace the first',
    commands: [start, ...complete('choose-bag'), { type: 'report', stepId: 'sort-clothes', status: 'confirmed', evidence: 'The clothes are laid out.' }],
    refused: { type: 'report', stepId: 'pack-toiletries', status: 'confirmed', evidence: 'The pouch is packed too.' }, errorCode: 'PENDING_CONFIRMATION',
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'sort-clothes', states: { 'sort-clothes': 'uncertain', 'pack-toiletries': 'pending' }, proposal: 'sort-clothes' },
  },
  {
    name: 'Not yet retracts a proposed completion without adding any confirmed event',
    commands: [start, { type: 'report', stepId: 'choose-bag', status: 'confirmed', evidence: 'The bag is open.' }, { type: 'report', stepId: 'choose-bag', status: 'uncertain', evidence: 'No, not yet. I need to check.' }, ...pauseReturn],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'uncertain' }, proposal: null },
  },
  {
    name: 'Correcting clothes selection invalidates packed clothes and closure, but retains the toiletries branch',
    commands: [start, ...complete(...all), { type: 'correct', stepId: 'sort-clothes', status: 'uncertain', reason: 'I selected the wrong clothes and must check the selection.' }],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'sort-clothes', states: { 'choose-bag': 'confirmed', 'sort-clothes': 'uncertain', 'pack-clothes': 'pending', 'pack-toiletries': 'confirmed', 'close-bag': 'pending' }, proposal: null, invalidated: ['pack-clothes', 'close-bag'] },
  },
  {
    name: 'A correction while paused records the change without silently resuming',
    commands: [start, ...complete('choose-bag'), { type: 'report', stepId: 'sort-clothes', status: 'started', evidence: 'I began selecting shirts.' }, { type: 'interrupt' }, { type: 'correct', stepId: 'sort-clothes', status: 'pending', reason: 'I abandoned that selection and will start it again.' }],
    expected: { phase: 'INTERRUPTED', kind: 'next', stepId: 'sort-clothes', states: { 'choose-bag': 'confirmed', 'sort-clothes': 'pending' }, proposal: null },
  },
  {
    name: 'An unrelated toiletries correction retains the pending clothes confirmation',
    commands: [start, ...complete('choose-bag', 'sort-clothes'), { type: 'report', stepId: 'pack-clothes', status: 'confirmed', evidence: 'All selected clothes are packed.' }, { type: 'correct', stepId: 'pack-toiletries', status: 'pending', reason: 'I still need to collect the pouch.' }],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'pack-clothes', states: { 'pack-clothes': 'uncertain', 'pack-toiletries': 'pending' }, proposal: 'pack-clothes' },
  },
  {
    name: 'An unknown step from another session is rejected without altering progress',
    commands: [start, ...complete('choose-bag')],
    refused: { type: 'report', stepId: 'sort-cables', status: 'confirmed', evidence: 'The cables are sorted.' }, errorCode: 'UNKNOWN_STEP',
    expected: { phase: 'ACTIVE', kind: 'next', stepId: 'sort-clothes', states: { 'choose-bag': 'confirmed' }, proposal: null },
  },
  {
    name: 'A stale client cannot apply its report after a newer interruption',
    commands: [start, { type: 'interrupt' }],
    refused: { type: 'report', stepId: 'choose-bag', status: 'confirmed', evidence: 'It is open.', expectedRevision: 1 }, errorCode: 'STALE_REVISION',
    expected: { phase: 'INTERRUPTED', kind: 'next', stepId: 'choose-bag', states: { 'choose-bag': 'pending' }, proposal: null },
  },
  {
    name: 'Five explicit confirmations finish the checklist with no invented next action',
    commands: [start, ...complete(...all)],
    expected: { phase: 'DONE', kind: 'complete', stepId: null, states: { 'choose-bag': 'confirmed', 'sort-clothes': 'confirmed', 'pack-clothes': 'confirmed', 'pack-toiletries': 'confirmed', 'close-bag': 'confirmed' }, proposal: null },
  },
  {
    name: 'Correcting the root of a completed checklist reopens it and invalidates every descendant',
    commands: [start, ...complete(...all), { type: 'correct', stepId: 'choose-bag', status: 'uncertain', reason: 'That was the wrong bag; I need to verify the intended bag.' }],
    expected: { phase: 'ACTIVE', kind: 'clarify', stepId: 'choose-bag', states: { 'choose-bag': 'uncertain', 'sort-clothes': 'pending', 'pack-clothes': 'pending', 'pack-toiletries': 'pending', 'close-bag': 'pending' }, proposal: null, invalidated: ['sort-clothes', 'pack-clothes', 'pack-toiletries', 'close-bag'] },
  },
  {
    name: 'Resetting a paused partial checklist clears current progress but keeps historical confirmations',
    commands: [start, ...complete('choose-bag'), { type: 'interrupt' }, { type: 'reset' }],
    expected: { phase: 'READY', kind: 'next', stepId: 'choose-bag', states: { 'choose-bag': 'pending', 'sort-clothes': 'pending', 'pack-clothes': 'pending', 'pack-toiletries': 'pending', 'close-bag': 'pending' }, proposal: null },
  },
];
