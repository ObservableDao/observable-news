// Minimal strict schema checker (zero dependencies).
// Every object is closed: a key that is not declared is an error.
// Errors are strings "<code>:<json-path>" so logs never contain content.

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const T = {
  object: (props, optional = []) => ({ t: 'object', props, optional: new Set(optional) }),
  array: (items, { min = 0, max = 1000 } = {}) => ({ t: 'array', items, min, max }),
  text: (max = 200, min = 1) => ({ t: 'text', min, max }),
  pattern: (re, max = 200) => ({ t: 'pattern', re, max }),
  oneOf: (...values) => ({ t: 'enum', values }),
  literal: value => ({ t: 'const', value }),
  bool: () => ({ t: 'bool' }),
  int: (min = 0, max = Number.MAX_SAFE_INTEGER) => ({ t: 'int', min, max }),
  https: () => ({ t: 'https' }),
  datetime: () => ({ t: 'datetime' }),
  date: () => ({ t: 'date' }),
};

export const ID = T.pattern(/^[a-z0-9][a-z0-9-]{0,79}$/, 80);
export const HANDLE = T.pattern(/^[a-z0-9][a-z0-9-]{1,39}$/, 40);
export const SHA256 = T.pattern(/^[0-9a-f]{64}$/, 64);
export const EVIDENCE_ID = T.pattern(/^ev-[a-z0-9-]{3,60}$/, 63);

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function checkHttps(v) {
  if (typeof v !== 'string' || v.length > 2048) return false;
  let u; try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
}

export function check(schema, value, path, errors) {
  const err = code => errors.push(`${code}:${path}`);
  switch (schema.t) {
    case 'object': {
      if (!isPlainObject(value)) return err('type-object');
      for (const k of Object.keys(value)) if (!(k in schema.props)) errors.push(`unexpected-field:${path}.${k}`);
      for (const [k, sub] of Object.entries(schema.props)) {
        if (!(k in value) || value[k] === undefined) { if (!schema.optional.has(k)) errors.push(`required:${path}.${k}`); continue; }
        check(sub, value[k], `${path}.${k}`, errors);
      }
      return;
    }
    case 'array':
      if (!Array.isArray(value)) return err('type-array');
      if (value.length < schema.min) err('min-items');
      if (value.length > schema.max) err('max-items');
      value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors));
      return;
    case 'text':
      if (typeof value !== 'string') return err('type-string');
      if (value.trim().length < schema.min) return err('empty');
      if (value.length > schema.max) err('too-long');
      if (CONTROL_CHARS.test(value)) err('control-chars');
      return;
    case 'pattern':
      if (typeof value !== 'string') return err('type-string');
      if (value.length > schema.max || !schema.re.test(value)) err('pattern');
      return;
    case 'enum': if (!schema.values.includes(value)) err('enum'); return;
    case 'const': if (value !== schema.value) err('const'); return;
    case 'bool': if (typeof value !== 'boolean') err('type-boolean'); return;
    case 'int': if (!Number.isSafeInteger(value) || value < schema.min || value > schema.max) err('type-int'); return;
    case 'https': if (!checkHttps(value)) err('https-url'); return;
    case 'datetime': if (typeof value !== 'string' || !ISO_DATETIME.test(value) || !Number.isFinite(Date.parse(value))) err('datetime'); return;
    case 'date': if (typeof value !== 'string' || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z'))) err('date'); return;
    default: throw new Error('unknown schema type ' + schema.t);
  }
}
