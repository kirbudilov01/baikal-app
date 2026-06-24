import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanTransition, publicStatus } from './status-machine.mjs';

test('allows expected admin status flow', () => {
  assert.doesNotThrow(() => assertCanTransition('moderation', 'transferred'));
  assert.doesNotThrow(() => assertCanTransition('transferred', 'in_progress'));
  assert.doesNotThrow(() => assertCanTransition('in_progress', 'resolved'));
});

test('blocks invalid status regressions and terminal updates', () => {
  assert.throws(() => assertCanTransition('moderation', 'resolved'), /Cannot move/);
  assert.throws(() => assertCanTransition('resolved', 'in_progress'), /Cannot move/);
});

test('returns mobile-safe public status payload', () => {
  assert.deepEqual(publicStatus('in_progress'), {
    code: 'in_progress',
    label: 'В работе',
    hint: 'Ответственные службы проверяют участок',
    terminal: false,
  });
});

