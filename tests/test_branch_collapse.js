'use strict';

const assert = require('assert');
const { collapseBranches, scoreBranch } = require('../lib/branch-collapse');

// scoreBranch ordering
assert.ok(scoreBranch([{ keyword: 'type' }]) > scoreBranch([{ keyword: 'minLength' }]));
assert.ok(scoreBranch([{ keyword: 'type' }, { keyword: 'minLength' }]) > scoreBranch([{ keyword: 'type' }]));

// oneOf with 1 match -> null
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type' }] },
      { valid: true, errors: [] },
      { valid: false, errors: [{ keyword: 'type' }] },
    ],
    parentPath: '/payment', parentSchemaPath: '#/properties/payment/oneOf',
  });
  assert.strictEqual(r, null);
}

// oneOf with 2 matches -> ATA4002
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [{ valid: true, errors: [] }, { valid: true, errors: [] }],
    parentPath: '', parentSchemaPath: '#/oneOf',
  });
  assert.strictEqual(r.code, 'ATA4002');
}

// oneOf with 0 matches -> ATA4001 + best branch
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type' }], title: 'wire' },         // score: 1*100+10=110
      { valid: false, errors: [{ keyword: 'minLength' }], title: 'card' },    // score: 1*100+3=103 (best)
      { valid: false, errors: [{ keyword: 'type' }, { keyword: 'enum' }] },   // score: 2*100+...=high
    ],
    parentPath: '', parentSchemaPath: '#/oneOf',
  });
  assert.strictEqual(r.code, 'ATA4001');
  assert.strictEqual(r.params.closest, 1);
  assert.strictEqual(r.params.closestName, 'card');
  assert.deepStrictEqual(r.branchErrors, [{ keyword: 'minLength' }]);
}

// anyOf with any match -> null
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [{ valid: false, errors: [{ keyword: 'type' }] }, { valid: true, errors: [] }],
    parentPath: '', parentSchemaPath: '#/anyOf',
  });
  assert.strictEqual(r, null);
}

// anyOf with 0 matches -> ATA4003
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [{ valid: false, errors: [{ keyword: 'type' }] }, { valid: false, errors: [{ keyword: 'minLength' }] }],
    parentPath: '', parentSchemaPath: '#/anyOf',
  });
  assert.strictEqual(r.code, 'ATA4003');
  assert.strictEqual(r.params.closest, 1);
}

// A branch that failed on `type` at the union's own path loses to one that
// got past its type, whatever the counts: the one type complaint says the
// value is not a string, the three field errors say what to fix.
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type', instancePath: '/a' }] },
      { valid: false, errors: [{ keyword: 'required', instancePath: '/a' }, { keyword: 'additionalProperties', instancePath: '/a' }, { keyword: 'type', instancePath: '/a/b' }] },
    ],
    parentPath: '/a', parentSchemaPath: '#/properties/a/anyOf',
  });
  assert.strictEqual(r.params.closest, 1);
}

// A `type` error below the union's path is a field error like any other.
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type', instancePath: '/a/b' }] },
      { valid: false, errors: [{ keyword: 'required', instancePath: '/a' }, { keyword: 'required', instancePath: '/a' }] },
    ],
    parentPath: '/a', parentSchemaPath: '#/properties/a/anyOf',
  });
  assert.strictEqual(r.params.closest, 0);
}

// When every branch failed on type, the score decides as before.
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type', instancePath: '' }, { keyword: 'enum', instancePath: '' }] },
      { valid: false, errors: [{ keyword: 'type', instancePath: '' }] },
    ],
    parentPath: '', parentSchemaPath: '#/oneOf',
  });
  assert.strictEqual(r.params.closest, 1);
}

console.log('ok: branch-collapse unit tests');

// End-to-end: oneOf/anyOf/allOf through the runtime Validator.
const { Validator } = require('..');
const oneofPayment = require('./fixtures/error-dx/composition/oneof-payment.json');
const anyofContact = require('./fixtures/error-dx/composition/anyof-contact.json');
const allofStrict = require('./fixtures/error-dx/composition/allof-strict.json');

// oneOf collapse: payment with a short card number should pick "card" variant
{
  const v = new Validator(oneofPayment);
  const r = v.validate({ payment: { number: '123' } });
  assert.strictEqual(r.valid, false);
  const e = r.errors.find(e => e.code === 'ATA4001');
  assert.ok(e, 'expected ATA4001 collapsed oneOf');
  assert.strictEqual(e.params.closestName, 'card');
  assert.ok(Array.isArray(e.branchErrors));
}

// oneOf multi-match: data that matches both card and paypal variants -> ATA4002
{
  const v = new Validator(oneofPayment);
  const r = v.validate({ payment: { number: '1234567890123', email: 'a@b.co' } });
  assert.strictEqual(r.valid, false);
  const e = r.errors.find(e => e.code === 'ATA4002');
  assert.ok(e, 'expected ATA4002 multi-match oneOf');
  // params.passingSchemas lists the branches that matched, the way the
  // interpreter and the reference implementation report it. It replaced
  // {matched, total}, which said how many without saying which.
  assert.deepStrictEqual(e.params.passingSchemas, [1, 2]); // card and paypal, not wire
}

// anyOf with neither matching -> ATA4003
{
  const v = new Validator(anyofContact);
  const r = v.validate({ contact: { email: 'not-an-email' } });
  assert.strictEqual(r.valid, false);
  const e = r.errors.find(e => e.code === 'ATA4003');
  assert.ok(e, 'expected ATA4003 collapsed anyOf');
}

// allOf does NOT collapse: both branch errors are surfaced separately
{
  const v = new Validator(allofStrict);
  const r = v.validate({ name: 'M', age: 12 });
  assert.strictEqual(r.valid, false);
  const codes = r.errors.map(e => e.code).sort();
  assert.ok(codes.includes('ATA2001'), 'allOf should surface minLength error');
  assert.ok(codes.includes('ATA2003'), 'allOf should surface minimum error');
  assert.ok(!codes.includes('ATA4004'), 'allOf must NOT collapse');
}

// A string or an object, and an object with a wrong key: the reported branch
// is the object one, on both engines, on the first call and once the
// validator has moved to its later tiers. The string branch's single `type`
// error outscored the object branch's field errors on count.
{
  const contact = {
    type: 'object',
    properties: {
      to: {
        anyOf: [
          { type: 'string', minLength: 1 },
          { type: 'object', properties: { key: { type: 'string' }, attributes: { type: 'object' } }, required: ['key', 'attributes'], additionalProperties: false },
        ],
      },
      cc: {
        anyOf: [
          { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind', 'address'] },
          { type: 'null' },
        ],
      },
    },
  };
  const cases = [
    [{ to: { type: 'email', value: 'a@b.c' } }, '/to', 1, ['required', 'required', 'additionalProperties', 'additionalProperties']],
    [{ to: { email: 'a@b.c', attributes: {} } }, '/to', 1, ['required', 'additionalProperties']],
    [{ to: { key: 'k', attributes: 1 } }, '/to', 1, ['type']],
    [{ to: 5 }, '/to', 0, ['type']],
    [{ cc: {} }, '/cc', 0, ['required', 'required']],
    [{ cc: 5 }, '/cc', 0, ['type']],
  ];
  for (const opts of [{}, { engine: 'interpreter' }]) {
    for (const [data, at, closest, keywords] of cases) {
      const v = new Validator(contact, opts);
      for (let i = 0; i < 100; i++) {
        const r = v.validate(data);
        const e = r.errors.find((x) => x.code === 'ATA4003' && x.instancePath === at);
        assert.ok(e, `${JSON.stringify(data)} ${JSON.stringify(opts)} call ${i + 1}: expected ATA4003 at ${at}`);
        assert.strictEqual(e.params.closest, closest, `${JSON.stringify(data)} ${JSON.stringify(opts)} call ${i + 1}`);
        assert.deepStrictEqual(e.branchErrors.map((x) => x.keyword), keywords, `${JSON.stringify(data)} ${JSON.stringify(opts)} call ${i + 1}`);
      }
    }
  }
}

console.log('ok: branch-collapse end-to-end');
