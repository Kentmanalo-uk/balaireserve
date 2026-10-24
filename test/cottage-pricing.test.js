'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateCottageTotal,
  validateCottageTimeRange,
} = require('../src/utils/cottagePricing');

test('uses the cottage rate as the booking total', () => {
  assert.equal(calculateCottageTotal(300), 300);
  assert.equal(calculateCottageTotal('1250.50'), 1250.5);
});

test('does not multiply the cottage rate by the selected hours', () => {
  assert.equal(calculateCottageTotal(500, '14:00', '22:00'), 500);
  assert.equal(calculateCottageTotal(300, '09:00', '17:00'), 300);
});

test('returns zero for an invalid cottage rate', () => {
  assert.equal(calculateCottageTotal(-1), 0);
  assert.equal(calculateCottageTotal('abc'), 0);
  assert.equal(calculateCottageTotal(undefined), 0);
});

test('rejects a cottage end time that is not after its start time', () => {
  assert.equal(validateCottageTimeRange('16:00', '14:00'), false);
  assert.equal(validateCottageTimeRange('14:00', '14:00'), false);
});

test('accepts a valid cottage time range', () => {
  assert.equal(validateCottageTimeRange('14:00', '16:00'), true);
});
