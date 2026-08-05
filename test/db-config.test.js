const assert = require('node:assert/strict');
const test = require('node:test');
const { connectionConfig } = require('../api/_lib/db');

test('interprets MySQL DATETIME values in the warehouse timezone by default', () => {
  const previous = process.env.DB_TIMEZONE;
  delete process.env.DB_TIMEZONE;
  try {
    assert.equal(connectionConfig().timezone, '-05:00');
  } finally {
    if (previous === undefined) delete process.env.DB_TIMEZONE;
    else process.env.DB_TIMEZONE = previous;
  }
});

test('allows the database timezone to be configured', () => {
  const previous = process.env.DB_TIMEZONE;
  process.env.DB_TIMEZONE = '+00:00';
  try {
    assert.equal(connectionConfig().timezone, '+00:00');
  } finally {
    if (previous === undefined) delete process.env.DB_TIMEZONE;
    else process.env.DB_TIMEZONE = previous;
  }
});
