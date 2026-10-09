import { retractPlacement } from '../web/placement-history.js';
import { assert } from './_util.js';

const state = (...keys) => ({ walls: keys.map((historyKey) => ({ historyKey })) });
const reserve = (undo, redo) => {
  const before = state(), token = { state: before, redoBefore: [...redo] };
  undo.push(before); redo.length = 0;
  return token;
};

Deno.test('failed placement: no undo step and prior redo remains available', () => {
  const undo = [state('accepted')], previous = state('redo'), redo = [previous];
  const token = reserve(undo, redo);
  retractPlacement(undo, redo, token, 'rejected');
  assert(undo.length === 1 && undo[0].walls[0].historyKey === 'accepted');
  assert(redo.length === 1 && redo[0] === previous);
});

Deno.test('failed placement: remove its own entry, preserve edits made while the worker ran', () => {
  const undo = [state('accepted')], redo = [];
  const token = reserve(undo, redo), later = state('accepted', 'pending', 'later');
  undo.push(later);
  retractPlacement(undo, redo, token, 'pending');
  assert(undo.length === 2 && undo[1] === later, 'discarded the later edit');
  assert(later.walls.map((w) => w.historyKey).join() === 'accepted,later', 'undo resurrects rejected wall');
  assert(!redo.length);
});

Deno.test('failed placement: multiple requests finishing together leave accepted history intact', () => {
  const undo = [], redo = [], failed = reserve(undo, redo);
  const accepted = state('failed'); undo.push(accepted);
  const secondFailed = reserve(undo, redo);
  retractPlacement(undo, redo, failed, 'failed');
  retractPlacement(undo, redo, secondFailed, 'second-failed');
  assert(undo.length === 1 && undo[0] === accepted && !accepted.walls.length);
});

Deno.test('failed placement: a pending request in redo cannot resurrect rejected geometry', () => {
  const undo = [], redo = [], token = reserve(undo, redo);
  const later = state('pending', 'accepted');
  redo.push(later);
  retractPlacement(undo, redo, token, 'pending');
  assert(!undo.length && redo.length === 1 && redo[0].walls[0].historyKey === 'accepted');
});
