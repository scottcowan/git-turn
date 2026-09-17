'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('./redact');

describe('redact — vendor pattern coverage (D-02: all 9 categories)', () => {
  test('redacts an AWS access key ID', () => {
    const { text, count } = redact('export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    assert.equal(count, 1);
    assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(text.includes('[REDACTED]'));
  });

  test('redacts a GitHub classic PAT', () => {
    const token = 'ghp_' + '1'.repeat(36);
    const { count, text } = redact(`use ${token} to auth`);
    assert.equal(count, 1);
    assert.ok(!text.includes(token));
  });

  test('redacts a GitHub fine-grained PAT', () => {
    const token = 'github_pat_' + 'a'.repeat(82);
    const { count, text } = redact(`use ${token} to auth`);
    assert.equal(count, 1);
    assert.ok(!text.includes(token));
  });

  test('redacts an OpenAI key (T3BlbkFJ marker present)', () => {
    const token = 'sk-' + 'a'.repeat(20) + 'T3BlbkFJ' + 'b'.repeat(20);
    assert.equal(redact(token).count, 1);
  });

  test('redacts an Anthropic key (sk-ant-api03- prefix, AA suffix)', () => {
    const token = 'sk-ant-api03-' + 'x'.repeat(93) + 'AA';
    assert.equal(redact(token).count, 1);
  });

  test('redacts a Slack bot token', () => {
    assert.equal(redact('xoxb-1234567890123-1234567890123-abcdEFGHijkl').count, 1);
  });

  test('redacts a Google API key', () => {
    const token = 'AIza' + 'A'.repeat(35);
    assert.equal(redact(token).count, 1);
  });

  test('redacts a Stripe live secret key', () => {
    const token = 'sk_live_' + 'B'.repeat(24);
    assert.equal(redact(token).count, 1);
  });

  test('redacts a generic key=value assignment', () => {
    const { count, text } = redact('API_KEY=abcdEFGH12345678ijkl');
    assert.equal(count, 1);
    assert.ok(!text.includes('abcdEFGH12345678ijkl'));
  });

  test('redacts a multi-line PEM private key header (SC1: PEM key fixture)', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIBOgIBAAJBAKj34GkxFhD90vcNLYBSbxCf1LMWWpn26EmyMvzRC8b7mLNSm3TQ',
      't1uRJH9jNJEyOOe2wc02uSp2vGxrhFhCPjkCAwEAAQ...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const { text, count } = redact(pem);
    assert.equal(count, 1);
    assert.ok(text.includes('[REDACTED]'));
    // Documented behavior (see 04-RESEARCH.md Pitfall 3): the header line
    // pattern only matches the header itself; the base64 body below it is
    // NOT separately pattern-matched (it may still be caught by the
    // entropy fallback if a body line clears the 20-char/4.5-bit floor —
    // that is incidental, not guaranteed, and is not asserted here).
  });

  test('redacts a .env-style block with multiple secrets (SC3: .env fixture)', () => {
    const envBlock = [
      'DATABASE_URL=postgres://user:hunter2@localhost/db',
      'STRIPE_SECRET_KEY=sk_live_' + 'C'.repeat(24),
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    ].join('\n');
    const { count } = redact(envBlock);
    // Expect >= 2: the Stripe key and the AWS key are vendor-shaped and
    // must both be caught. The embedded "hunter2" password is a documented
    // false negative — see the dedicated low-entropy fixture below — so
    // this assertion intentionally uses >= rather than a fixed count.
    assert.ok(count >= 2);
  });

  test('marker format is untagged and reveals no secret fragment (D-01)', () => {
    const { text } = redact('export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    assert.ok(text.includes('[REDACTED]'));
    assert.ok(!/\[REDACTED[-:]/.test(text), 'marker must not be type-tagged');
    assert.ok(!text.includes('AKIA'), 'no prefix fragment of the secret must survive');
    assert.ok(!text.includes('MPLE'), 'no suffix fragment of the secret must survive');
  });
});

describe('redact — SHA/UUID whitelist (D-03: must NOT redact)', () => {
  test('does not redact a 40-hex git commit SHA', () => {
    const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    const { text, count } = redact(`see commit ${sha} for details`);
    assert.ok(text.includes(sha), 'SHA must survive redaction untouched');
    assert.equal(count, 0);
  });

  test('does not redact a UUID-v4 session id', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const { text, count } = redact(`session ${uuid} failed`);
    assert.ok(text.includes(uuid), 'UUID must survive redaction untouched');
    assert.equal(count, 0);
  });

  test('a random high-entropy token with NO vendor prefix IS redacted (fallback works)', () => {
    // 32-char base64, no vendor shape — must be caught by entropy alone.
    const token = 'wcqv6MU0Bxy/EJs6ziRjRvtmqU8H3xcL';
    const { text, count } = redact(`rotated secret: ${token}`);
    assert.ok(!text.includes(token));
    assert.equal(count, 1);
  });
});

describe('redact — documented false negatives (D-03: not silent, proven by test)', () => {
  test('KNOWN GAP: a paraphrased secret with no vendor marker is NOT redacted', () => {
    const { text } = redact('the token is sk-abc123, does that look valid?');
    // Intentionally asserts the secret text SURVIVES — this fixture
    // documents/proves the false negative described in 04-RESEARCH.md
    // Pitfall 4, rather than silently hoping no one notices the gap.
    assert.ok(text.includes('sk-abc123'));
  });

  test('KNOWN GAP: a short, low-entropy password is NOT redacted', () => {
    const { text } = redact('the password is hunter2');
    assert.ok(text.includes('hunter2'));
  });

  test('does not redact ordinary prose with no secret-shaped content', () => {
    const prose = 'Please refactor the auth middleware to use async/await.';
    const { text, count } = redact(prose);
    assert.equal(count, 0);
    assert.equal(text, prose);
  });

  test('empty input returns empty output with zero count', () => {
    assert.deepEqual(redact(''), { text: '', count: 0 });
  });
});
