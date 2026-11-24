'use strict';

// Branch collapse: when no branch of an anyOf or oneOf matches, listing every
// branch's errors tells a reader that nothing fit without telling them which
// branch they meant. This scores the branches, reports the one that came
// closest, and keeps its errors under `branchErrors` for the pretty renderer.
//
// There is one implementation, and it is `__ataCollapse` below. A standalone
// module imports nothing, so the generated code cannot require this file; it
// carries a copy emitted by `embedSource()` from these very functions instead
// of a second hand-written one. That is why the internals are written in the
// positional form the generated code calls, and why each function reaches the
// others only through properties on itself (`__ataCollapse.F`, `.M`,
// `__ataScore.S`): a bundler that minifies names renames a function and every
// call to it, and the text toString() gives then called names the embed did
// not declare. A function's reference to its own name stays consistent, and
// property names are not renamed.

// How much a failing keyword says about intent. A branch that fails on `type`
// was probably not the branch the author meant; one that fails on `minLength`
// probably was, and is the better thing to show. The error count dominates, so
// a branch with one complaint always beats a branch with three, among the
// branches that got past their type (see __ataCollapse).
const __ATA_SEVERITY = {
  type: 10,
  const: 8,
  enum: 8,
  required: 5,
  format: 3,
  minLength: 3,
  maxLength: 3,
  minimum: 3,
  maximum: 3,
  pattern: 3,
  additionalProperties: 2,
  unevaluatedProperties: 2,
  unevaluatedItems: 2,
};

function __ataScore (errs) {
  if (!errs || !errs.length) return 0;
  const sev = __ataScore.S;
  let s = 0;
  for (const e of errs) s += sev[e.keyword] || 4;
  return errs.length * 100 + s; // primary: count, secondary: severity
}
__ataScore.S = __ATA_SEVERITY;

// `br` is one entry per branch in declaration order: {valid, errors} and a
// `title`, or the titles in `titles` when given (the generated code passes
// each branch's result as it is rather than copying it to add one).
// Returns the single error to report, or null when the keyword is satisfied.
// oneOf passed by more than one branch; generated code builds it from a count.
function __ataMulti (passIdx, total, pp, sp, o) {
  const multi = {
    code: 'ATA4002',
    keyword: 'oneOf',
    instancePath: pp || '',
    path: pp || '',
    schemaPath: sp,
    message: 'value matched ' + passIdx.length + ' of ' + total + ' oneOf variants, expected exactly one',
    params: { passingSchemas: passIdx },
  };
  if (o !== null) Object.defineProperty(multi, '_o', { value: o });
  return multi;
}

// A branch's errors as the picker reads them. A failed anyOf or oneOf at the
// union's own path, a branch that is itself a union (`z.union([a,
// z.union([b, c])])`, TypeBox's Intersect of nullable objects), is one
// collapsed error whose `branchErrors` say what it failed on; read as one
// error with no `type` among them, it looked like a branch that got past its
// type with a single complaint. It stands for its reported branch's errors,
// at every depth. Errors below that path are left as they are: a union on a
// field is one error about that field.
function __ataLift (errs, at) {
  if (!errs) return errs;
  let out = null;
  for (let i = 0; i < errs.length; i++) {
    const e = errs[i];
    if (e && e.instancePath === at && (e.keyword === 'anyOf' || e.keyword === 'oneOf') && Array.isArray(e.branchErrors) && e.branchErrors.length > 0) {
      if (out === null) out = errs.slice(0, i);
      const inner = __ataLift(e.branchErrors, at);
      for (let j = 0; j < inner.length; j++) out.push(inner[j]);
    } else if (out !== null) {
      out.push(e);
    }
  }
  return out === null ? errs : out;
}

function __ataCollapse (kw, br, pp, sp, o, titles) {
  let passN = 0;
  for (let i = 0; i < br.length; i++) if (br[i].valid) passN++;
  const pass = { length: passN };
  if (kw === 'oneOf') {
    if (pass.length === 1) return null;
    if (pass.length > 1) {
      const passIdx = [];
      for (let i = 0; i < br.length; i++) if (br[i].valid) passIdx.push(i);
      return __ataCollapse.M(passIdx, br.length, pp, sp, o);
    }
  } else if (pass.length >= 1) {
    return null;
  }
  // A branch that failed on `type` at the union's own path was not written
  // for this value, so its one complaint says nothing about what to fix; a
  // branch of the value's type that failed on three fields says exactly that.
  // For `anyOf: [{ type: 'string' }, { type: 'object', ... }]` and an object
  // with a wrong key, scoring alone picked the string branch ("must be
  // string"). The score decides among the branches that got past their type,
  // and among all of them only when none did. Both read a nested union at
  // this path through the errors it reported (__ataLift).
  const at = pp || '';
  let bi = 0;
  let bs = Infinity;
  let bt = true;
  for (let i = 0; i < br.length; i++) {
    const errs = __ataCollapse.L(br[i].errors, at);
    let t = false;
    if (errs) {
      for (let j = 0; j < errs.length; j++) {
        if (errs[j].keyword === 'type' && errs[j].instancePath === at) { t = true; break; }
      }
    }
    const s = __ataCollapse.F(errs);
    if ((bt && !t) || (t === bt && s < bs)) { bs = s; bi = i; bt = t; }
  }
  const best = br[bi];
  // The ordering key, when there is one, is not enumerable: the error is
  // otherwise in the shape it is handed out in, and a caller that reads it
  // as it comes (the combined function's one-pass result) does not copy it.
  const none = {
    code: kw === 'oneOf' ? 'ATA4001' : 'ATA4003',
    keyword: kw,
    instancePath: pp || '',
    path: pp || '',
    schemaPath: sp,
    message: 'value matched 0 of ' + br.length + ' ' + kw + ' variants',
    params: { variants: br.length, closest: bi, closestName: (titles !== undefined ? titles[bi] : best.title) || ('variant ' + (bi + 1)) },
    branchErrors: best.errors,
  };
  if (o !== null) Object.defineProperty(none, '_o', { value: o });
  return none;
}

__ataCollapse.M = __ataMulti;
__ataCollapse.F = __ataScore;
__ataCollapse.L = __ataLift;

// The named-argument form the interpreter and the tests call.
function collapseBranches ({ keyword, branchResults, parentPath, parentSchemaPath, ordinal }) {
  return __ataCollapse(keyword, branchResults, parentPath, parentSchemaPath, ordinal === undefined ? null : ordinal);
}

// The five declarations as source, for the generated code to carry. Derived
// from the functions above rather than written out again, so a fix to one
// cannot miss the other. `tests/test_branch_collapse.js` runs both.
function embedSource () {
  return 'const __ATA_SEVERITY=' + JSON.stringify(__ATA_SEVERITY) + ';' +
    'const __ataScore=' + __ataScore.toString() + ';__ataScore.S=__ATA_SEVERITY;' +
    'const __ataMulti=' + __ataMulti.toString() + ';' +
    'const __ataLift=' + __ataLift.toString() + ';' +
    'const __ataCollapse=' + __ataCollapse.toString() + ';__ataCollapse.M=__ataMulti;__ataCollapse.F=__ataScore;__ataCollapse.L=__ataLift;';
}

module.exports = { collapseBranches, scoreBranch: __ataScore, SEVERITY: __ATA_SEVERITY, embedSource, _collapse: __ataCollapse, _multi: __ataMulti };
