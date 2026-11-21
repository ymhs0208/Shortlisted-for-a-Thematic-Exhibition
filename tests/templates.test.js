import assert from 'node:assert/strict';
import test from 'node:test';
import { getPosterTemplate, posterTemplates } from '../js/poster-renderer.js';

test('the studio ships six poster templates', () => {
  assert.deepEqual(posterTemplates.map(template => template.id), [
    'original',
    'warm',
    'minimal',
    'shortlist',
    'letterpress',
    'annual-banner',
  ]);
  assert.equal(posterTemplates.length, 6);
  assert.equal(getPosterTemplate('missing').id, 'original');
  for (const template of posterTemplates) {
    assert.equal(template.fields.length, 3);
    assert.equal(template.poster.length, 4);
    assert.match(template.src, /^\.\/assets\//);
  }
});
