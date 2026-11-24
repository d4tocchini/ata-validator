'use strict';
// ATA_LEAN=1 (lib/validator-core.js): a validator generates code for its
// verdict and nothing else. Its errors come from the interpreted engine, and
// validate() keeps its first tier. The switch is read at load, so the lean
// half runs in a child process. Checked: on the official suite's 2020-12 and
// draft-07 groups, with richErrors on and off, every verdict and every error
// list (keyword, paths, params, message, branch errors) is the one the
// default build gives, on a validator's first call and past its 64th; engine()
// still says codegen; and a lean validator compiles nothing after its verdict,
// however often its errors are read, where the default build compiles.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LEAN = process.env.ATA_LEAN === '1';
const { Validator } = require('..');

const SUITE = path.join(__dirname, 'suite/tests');
const REMOTES = path.join(__dirname, 'suite/remotes');
const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' };

const registry = {};
(function collect(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, prefix + entry.name + '/');
    else if (entry.name.endsWith('.json')) {
      try { registry['http://localhost:1234/' + prefix + entry.name] = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {}
    }
  }
})(REMOTES, '');

const shape = (errors) => errors.map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message, e.params, Array.isArray(e.branchErrors) ? shape(e.branchErrors) : null]);
const answer = (r) => (r.valid ? true : shape(r.errors));

function answers() {
  const out = [];
  for (const [dialect, uri] of Object.entries(DIALECTS)) {
    const dir = path.join(SUITE, dialect);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
        const schema = typeof group.schema === 'object' && group.schema !== null && !Array.isArray(group.schema) && !('$schema' in group.schema) ? { ...group.schema, $schema: uri } : group.schema;
        for (const richErrors of [false, true]) {
          let v;
          try {
            v = new Validator(schema, { schemas: registry, assertFormat: false, useDefaults: false, richErrors });
            v.isValidObject(null);
          } catch (e) {
            out.push([dialect, file, group.description, richErrors, 'throws']);
            continue;
          }
          const first = group.tests.map((t) => answer(v.validate(t.data)));
          for (let i = 0; i < 70; i++) for (const t of group.tests) void v.validate(t.data).errors;
          const later = group.tests.map((t) => answer(v.validate(t.data)));
          out.push([dialect, file, group.description, richErrors, v.engine(), first, later]);
        }
      }
    }
  }
  return out;
}

// How many functions a validator compiles after its first rejection, over 400
// more calls with its errors read on every rejection. A rejection is what
// compiles a validator that answered its first calls on the small-schema twin
// (lib/codegen-engine.js SmallTwin), so the count starts after one.
function compiledLater() {
  const schema = { type: 'object', properties: { to: { anyOf: [{ type: 'string' }, { type: 'object', properties: { key: { type: 'string', minLength: 2 } }, required: ['key'], additionalProperties: false }] }, n: { type: 'integer', minimum: 1 } }, required: ['to'] };
  const v = new Validator(schema, { richErrors: true });
  void v.validate({ to: 5 }).errors;
  const Real = globalThis.Function;
  let n = 0;
  globalThis.Function = new Proxy(Real, { construct(t, args) { n++; return Reflect.construct(t, args); } });
  try {
    for (let i = 0; i < 200; i++) {
      void v.validate({ to: 'a', n: 2 }).errors;
      void v.validate({ to: { key: 'x', extra: 1 }, n: 0 }).errors;
    }
  } finally {
    globalThis.Function = Real;
  }
  return { engine: v.engine(), compiled: n };
}

if (LEAN) {
  process.stdout.write(JSON.stringify({ answers: answers(), later: compiledLater() }));
} else {
  const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, ATA_LEAN: '1' }, maxBuffer: 1 << 30, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const lean = JSON.parse(r.stdout);
  const ref = answers();
  assert.strictEqual(lean.answers.length, ref.length);
  let groups = 0;
  for (let i = 0; i < ref.length; i++) {
    assert.deepStrictEqual(lean.answers[i], ref[i], `${ref[i].slice(0, 4).join(' :: ')}`);
    if (ref[i][4] === 'codegen') groups++;
  }
  assert.ok(groups > 1000, `${groups} groups reached the code generator`);
  const full = compiledLater();
  assert.strictEqual(lean.later.engine, 'codegen');
  assert.strictEqual(lean.later.compiled, 0, 'a lean validator compiled after its verdict');
  assert.ok(full.compiled > 0, 'the default build compiled nothing after the verdict, so the count above proves nothing');
  console.log(`ok: ATA_LEAN gives the default build's verdicts and errors on ${ref.length} suite groups (${groups} on generated code), and compiles nothing after the verdict (the default build compiled ${full.compiled})`);
}
