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
// branches that got past their type and their tag (see __ataCollapse).
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

// Whether a branch's errors (as __ataLift reads them) say anything against
// the property `seg` (a JSON Pointer segment) of the value at `at`: an error
// at that property, or the object at `at` refusing the key itself.
function __ataAgainst (errs, at, seg) {
  if (!errs) return false;
  const p = at + '/' + seg;
  for (let i = 0; i < errs.length; i++) {
    const e = errs[i];
    if (!e) continue;
    if (e.instancePath === p) return true;
    if (e.instancePath === at && e.params) {
      const k = e.keyword === 'additionalProperties' ? e.params.additionalProperty : e.keyword === 'unevaluatedProperties' ? e.params.unevaluatedProperty : undefined;
      if (typeof k === 'string' && k.replace(/~/g, '~0').replace(/\//g, '~1') === seg) return true;
    }
  }
  return false;
}

// The branch reported is the one the value was meant for, and a value says
// which that is by its type and by its tag, as a discriminated union reads
// it (ajv's discriminator, Zod's discriminatedUnion). Branches are compared
// in order of three rules, and the first branch wins a tie on all three:
// 1. One that failed `type` at the union's own path loses to one that did
//    not: `anyOf: [{ type: 'string' }, { type: 'object', ... }]` and an
//    object with a wrong key is about the key, not "must be string".
// 2. Then one that refused the `const` or `enum` of a property the value
//    holds loses to one that said nothing against that property: for
//    `{ kind: 'date' }` the `all` branch's `kind must be "all"` is a tag
//    that does not match, and the date branch's missing `from` and `to`
//    are what to fix. Only a property directly under the union's path is a
//    tag; rules 1 and 2 compare only branches that got past their type.
// 3. Then the score: fewer errors, then milder ones (__ataScore).
// A nested anyOf or oneOf at the union's path is read through the branch
// it reported (__ataLift), which it picked by the same rules. These notes
// sit outside the function: its text is carried in every generated module.
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
  const at = pp || '';
  const n = br.length;
  const L = new Array(n);
  const T = new Array(n);
  for (let i = 0; i < n; i++) {
    const errs = __ataCollapse.L(br[i].errors, at);
    L[i] = errs;
    let t = false;
    if (errs) {
      for (let j = 0; j < errs.length; j++) {
        if (errs[j] && errs[j].keyword === 'type' && errs[j].instancePath === at) { t = true; break; }
      }
    }
    T[i] = t;
  }
  let bi = 0;
  let bs = Infinity;
  let bt = true;
  let bm = true;
  for (let i = 0; i < n; i++) {
    const errs = L[i];
    const t = T[i];
    let m = false;
    if (!t && errs) {
      for (let j = 0; j < errs.length && !m; j++) {
        const e = errs[j];
        if (!e || (e.keyword !== 'const' && e.keyword !== 'enum')) continue;
        const ip = e.instancePath;
        if (typeof ip !== 'string' || ip.length <= at.length + 1 || ip.slice(0, at.length + 1) !== at + '/') continue;
        const seg = ip.slice(at.length + 1);
        if (seg.indexOf('/') !== -1) continue;
        for (let k = 0; k < n; k++) {
          if (k !== i && !T[k] && !__ataCollapse.A(L[k], at, seg)) { m = true; break; }
        }
      }
    }
    const s = __ataCollapse.F(errs);
    if ((bt && !t) || (t === bt && ((bm && !m) || (m === bm && s < bs)))) { bs = s; bi = i; bt = t; bm = m; }
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
__ataCollapse.A = __ataAgainst;

// The named-argument form the interpreter and the tests call.
function collapseBranches ({ keyword, branchResults, parentPath, parentSchemaPath, ordinal }) {
  return __ataCollapse(keyword, branchResults, parentPath, parentSchemaPath, ordinal === undefined ? null : ordinal);
}

// The six declarations as source, for the generated code to carry. Derived
// from the functions above rather than written out again, so a fix to one
// cannot miss the other. `tests/test_branch_collapse.js` runs both.
function embedSource () {
  return 'const __ATA_SEVERITY=' + JSON.stringify(__ATA_SEVERITY) + ';' +
    'const __ataScore=' + __ataScore.toString() + ';__ataScore.S=__ATA_SEVERITY;' +
    'const __ataMulti=' + __ataMulti.toString() + ';' +
    'const __ataLift=' + __ataLift.toString() + ';' +
    'const __ataAgainst=' + __ataAgainst.toString() + ';' +
    'const __ataCollapse=' + __ataCollapse.toString() + ';__ataCollapse.M=__ataMulti;__ataCollapse.F=__ataScore;__ataCollapse.L=__ataLift;__ataCollapse.A=__ataAgainst;';
}

module.exports = { collapseBranches, scoreBranch: __ataScore, SEVERITY: __ATA_SEVERITY, embedSource, _collapse: __ataCollapse, _multi: __ataMulti };
