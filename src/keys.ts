import { gtinCheckDigit } from './check-digit.ts'
import { encodeSegment } from './percent-encode.ts'

/**
 * The GS1 Digital Link key space: which Application Identifiers can start a
 * path, which may follow them, and in what order.
 *
 * A Digital Link is addressed by its key, so the path has to be a single
 * canonical string: two spellings of the same identifier must never become two
 * links. That is what this module enforces — values are validated and
 * normalised, qualifiers are emitted in the order the grammar fixes, and a path
 * that does not obey the grammar is refused rather than guessed at.
 *
 * Reference: GS1 Digital Link URI Syntax 1.7.0 (ratified August 2026), and the
 * GS1 General Specifications for the key formats and the check digit.
 *
 * One sentence from the standard is worth repeating because it is easy to get
 * wrong: a Digital Link on your own domain is a conformant URI and is never a
 * *canonical* one. Canonical means `https://id.gs1.org/…` by definition.
 */

// ---------------------------------------------------------------------------
// Character sets
// ---------------------------------------------------------------------------

/**
 * XCHAR: the 82-character GS1 AI-encodable set, which is what most
 * alphanumeric AI values may contain. Case is significant — a serial number is
 * not lower-cased on its way in, because the standard does not lower-case it
 * and two cases are two different items.
 */
const XCHAR = /^[A-Za-z0-9!"%&'()*+,\-./:;<=>?_]+$/

/** YCHAR: the 39-character set, used by the CPID and nothing else. */
const YCHAR = /^[0-9A-Z#\-/]+$/

// ---------------------------------------------------------------------------
// Primary keys
// ---------------------------------------------------------------------------

/**
 * How a key's value is checked. Each is a rule from the General
 * Specifications, named rather than spelled out at every call site.
 *
 *  - `gtin`    8, 12, 13 or 14 digits, modulo-10, stored padded to 14.
 *  - `digits`  a fixed number of digits, modulo-10 over the last one.
 *  - `head13`  13 digits carrying the check digit, then an optional tail.
 *  - `itip`    18 digits whose 14th is the GTIN check digit.
 *  - `grai`    a literal `0`, then 13 digits carrying the check digit, then an
 *              optional serial.
 *  - `xchar`   free text in the 82-character set, with no check digit.
 *  - `ychar`   free text in the 39-character set, with no check digit.
 */
export type KeyRule = 'gtin' | 'digits' | 'head13' | 'itip' | 'grai' | 'xchar' | 'ychar'

/**
 * A primary key: the AI a Digital Link path opens with.
 *
 * `qualifiers` are the AIs that may follow it, **in this order**. The order is
 * not a preference. The standard's grammar is
 * `gtin-path = gtin-comp [cpv-comp] [lot-comp] [ser-comp]`, with the note that
 * "the sequence in which they appear is important and must be preserved" — so
 * `/01/…/21/…/10/…` is not a rearrangement of `/01/…/10/…/21/…`, it is invalid.
 * A resolver that accepted both would hand out two addresses for one item.
 */
export interface Gs1PrimaryKey {
  ai: string
  /** How it reads in a message to somebody who typed it wrong. */
  label: string
  qualifiers: readonly string[]
  rule: KeyRule
  /** Exact digit counts, for `digits`. */
  length?: number
  /** Longest the whole value may be. */
  maxLength: number
  /** Longest the part after a 13-digit head may be, for `head13` and `grai`. */
  tailMax?: number
  /** Digits only in that tail: a GCN's serial is numeric, a GDTI's is not. */
  tailDigits?: boolean
}

/**
 * The primary keys this library addresses links by.
 *
 * Short of the standard's full set, on purpose. Left out are the three paths
 * whose grammar makes a qualifier *mandatory* — `415` pay-to GLN, which
 * requires a payment slip reference, and the EOID, FID and MID forms, which
 * require the `7040` UIC extension — because each is a second, incompatible
 * grammar over a key that also has a plain form, and half-supporting one is
 * worse than not offering it. `235` TPX is left out for the same reason: it
 * replaces the CPV/batch/serial sequence after a GTIN rather than joining it.
 *
 * Adding any of them later is this table plus its rule, and nothing else.
 */
export const PRIMARY_KEYS: Record<string, Gs1PrimaryKey> = {
  '00': { ai: '00', label: 'SSCC', qualifiers: [], rule: 'digits', length: 18, maxLength: 18 },
  '01': {
    ai: '01',
    label: 'GTIN',
    // CPV, then batch, then serial. The order the grammar fixes.
    qualifiers: ['22', '10', '21'],
    rule: 'gtin',
    maxLength: 14,
  },
  '253': {
    ai: '253',
    label: 'GDTI',
    qualifiers: [],
    rule: 'head13',
    maxLength: 30,
    tailMax: 17,
  },
  '255': {
    ai: '255',
    label: 'GCN',
    qualifiers: [],
    rule: 'head13',
    maxLength: 25,
    tailMax: 12,
    tailDigits: true,
  },
  '401': { ai: '401', label: 'GINC', qualifiers: [], rule: 'xchar', maxLength: 30 },
  '402': { ai: '402', label: 'GSIN', qualifiers: [], rule: 'digits', length: 17, maxLength: 17 },
  '414': { ai: '414', label: 'GLN', qualifiers: ['254'], rule: 'digits', length: 13, maxLength: 13 },
  '417': { ai: '417', label: 'Party GLN', qualifiers: [], rule: 'digits', length: 13, maxLength: 13 },
  '8003': { ai: '8003', label: 'GRAI', qualifiers: [], rule: 'grai', maxLength: 30, tailMax: 16 },
  '8004': { ai: '8004', label: 'GIAI', qualifiers: [], rule: 'xchar', maxLength: 30 },
  '8006': {
    ai: '8006',
    label: 'ITIP',
    qualifiers: ['22', '10', '21'],
    rule: 'itip',
    maxLength: 18,
  },
  '8010': { ai: '8010', label: 'CPID', qualifiers: ['8011'], rule: 'ychar', maxLength: 30 },
  // A GMN ends in a check character *pair* over the 82-character set, computed
  // modulo 1021 — not the modulo-10 digit every other key here uses. It is not
  // verified; the length and character rules are.
  '8013': { ai: '8013', label: 'GMN', qualifiers: [], rule: 'xchar', maxLength: 25 },
  '8017': {
    ai: '8017',
    label: 'GSRN (provider)',
    qualifiers: ['8019'],
    rule: 'digits',
    length: 18,
    maxLength: 18,
  },
  '8018': {
    ai: '8018',
    label: 'GSRN (recipient)',
    qualifiers: ['8019'],
    rule: 'digits',
    length: 18,
    maxLength: 18,
  },
}

export const PRIMARY_KEY_AIS: readonly string[] = Object.keys(PRIMARY_KEYS)

/** A qualifier's own shape, so a batch of forty characters is refused by name. */
export interface Gs1Qualifier {
  ai: string
  label: string
  maxLength: number
  digits?: boolean
}

export const QUALIFIERS: Record<string, Gs1Qualifier> = {
  '10': { ai: '10', label: 'Batch or lot', maxLength: 20 },
  '21': { ai: '21', label: 'Serial number', maxLength: 20 },
  '22': { ai: '22', label: 'Consumer product variant', maxLength: 20 },
  '254': { ai: '254', label: 'GLN extension', maxLength: 20 },
  '8011': { ai: '8011', label: 'CPID serial', maxLength: 12, digits: true },
  '8019': { ai: '8019', label: 'Service relation instance', maxLength: 10, digits: true },
}

// ---------------------------------------------------------------------------
// Check digits
// ---------------------------------------------------------------------------

export interface KeyCheck {
  ok: boolean
  /** The value as it will be stored: the one spelling of this identifier. */
  normalised: string | null
  message?: string
}

/**
 * Where a modulo-10 check digit went wrong, in words somebody can act on.
 *
 * It names the digit that should have been there. That is the whole reason the
 * check digit exists — a transposed pair is the commonest way a number gets
 * copied wrong off a pack — and "invalid GTIN" sends somebody back to retype
 * the same fourteen digits, while "should end in 2, not 5" finds the mistake.
 *
 * `gtinCheckDigit` weights the data digits 3 and 1 from the right, which is
 * the General Specifications' rule for every fixed-length numeric GS1 key. The
 * alternation therefore starts differently for an odd- and an even-length key
 * and nothing here has to know which: it is counted from the right.
 */
function checkedDigits(value: string, label: string): KeyCheck {
  const body = value.slice(0, -1)
  const given = value.slice(-1)
  const expected = String(gtinCheckDigit(body))
  if (given !== expected) {
    return {
      ok: false,
      normalised: null,
      message:
        `Check digit is wrong: this ${label} should end in ${expected}, not ${given}. ` +
        'Retype it — a swapped pair of digits is the usual cause.',
    }
  }
  return { ok: true, normalised: value }
}

function bad(message: string): KeyCheck {
  return { ok: false, normalised: null, message }
}

/**
 * Validate a thirteen-digit head with its check digit, plus whatever follows.
 *
 * A GDTI, a GCN and a GRAI are all "a thirteen-digit number that carries the
 * check digit, then a serial that does not". Checking the last character of
 * the whole string would reject every one of them that has a serial.
 */
function checkHead13(spec: Gs1PrimaryKey, value: string, offset = 0): KeyCheck {
  const head = value.slice(offset, offset + 13)
  if (!/^\d{13}$/.test(head)) {
    return bad(`A ${spec.label} starts with 13 digits: 12 of number and its check digit.`)
  }
  const checked = checkedDigits(head, spec.label)
  if (!checked.ok) return checked

  const tail = value.slice(offset + 13)
  if (tail) {
    if (tail.length > (spec.tailMax ?? 0)) {
      return bad(`The part after a ${spec.label}'s 13 digits is at most ${spec.tailMax} characters.`)
    }
    if (spec.tailDigits && !/^\d+$/.test(tail)) {
      return bad(`The part after a ${spec.label}'s 13 digits is digits only.`)
    }
    if (!spec.tailDigits && !XCHAR.test(tail)) {
      return bad(`A ${spec.label} contains a character a GS1 symbol cannot carry.`)
    }
  }
  return { ok: true, normalised: value }
}

/**
 * Validate one primary key's value and return the single spelling we store it
 * under.
 *
 * A GTIN is normalised to fourteen digits, because GTIN-8, -12, -13 and -14
 * are the same number with different leading zeros and the standard requires
 * the Digital Link form to carry fourteen. Without that,
 * `/01/05012345678900` and `/01/5012345678900` would be two links to one
 * product — and the second is what somebody types. Padding is neutral for the
 * check digit, so the check runs after it.
 */
export function checkGs1Key(ai: string, raw: string): KeyCheck {
  const spec = PRIMARY_KEYS[ai]
  if (!spec) return bad(`${ai} is not a GS1 primary key.`)

  // Trimmed, never squeezed: a space inside a digit key is spacing somebody
  // copied off a pack and is removed with the hyphens below, but a space
  // inside an asset number is a character a GS1 symbol cannot carry and has to
  // be refused rather than quietly deleted.
  const value = raw.trim()
  if (!value) return bad(`Enter a ${spec.label}.`)

  switch (spec.rule) {
    case 'gtin': {
      // Hyphens are how a GTIN is printed on a pack, so they are stripped
      // rather than refused; anything else that is not a digit is the mistake.
      const digits = value.replace(/[\s-]/g, '')
      if (!/^\d+$/.test(digits)) return bad('A GTIN is digits only.')
      if (![8, 12, 13, 14].includes(digits.length)) {
        return bad(`A GTIN is 8, 12, 13 or 14 digits. That is ${digits.length}.`)
      }
      const padded = digits.padStart(14, '0')
      const checked = checkedDigits(padded, 'GTIN')
      return checked.ok ? { ok: true, normalised: padded } : checked
    }
    case 'digits': {
      const digits = value.replace(/[\s-]/g, '')
      if (!/^\d+$/.test(digits)) return bad(`A ${spec.label} is digits only.`)
      if (digits.length !== spec.length) {
        return bad(`A ${spec.label} is ${spec.length} digits. That is ${digits.length}.`)
      }
      return checkedDigits(digits, spec.label)
    }
    case 'itip': {
      const digits = value.replace(/[\s-]/g, '')
      if (!/^\d{18}$/.test(digits)) return bad('An ITIP is 18 digits: a GTIN, then the piece and the total.')
      // The GTIN's check digit is the fourteenth of the eighteen, followed by
      // the piece and total numbers, so it is checked where it actually is.
      const checked = checkedDigits(digits.slice(0, 14), 'ITIP')
      return checked.ok ? { ok: true, normalised: digits } : checked
    }
    case 'head13':
      if (value.length > spec.maxLength) {
        return bad(`A ${spec.label} is at most ${spec.maxLength} characters. That is ${value.length}.`)
      }
      return checkHead13(spec, value)
    case 'grai':
      // The standard writes the path value as a literal `0` and then the
      // thirteen digits, because AI 8003's element string opens with one.
      if (!value.startsWith('0')) return bad('A GRAI starts with a zero, then 13 digits and an optional serial.')
      if (value.length > spec.maxLength) {
        return bad(`A GRAI is at most ${spec.maxLength} characters. That is ${value.length}.`)
      }
      return checkHead13(spec, value, 1)
    case 'ychar':
      if (value.length > spec.maxLength) {
        return bad(`A ${spec.label} is at most ${spec.maxLength} characters. That is ${value.length}.`)
      }
      if (!YCHAR.test(value)) {
        return bad(`A ${spec.label} may only use capital letters, digits and # - /`)
      }
      return { ok: true, normalised: value }
    case 'xchar':
      if (value.length > spec.maxLength) {
        return bad(`A ${spec.label} is at most ${spec.maxLength} characters. That is ${value.length}.`)
      }
      if (!XCHAR.test(value)) {
        return bad(`A ${spec.label} contains a character a GS1 symbol cannot carry.`)
      }
      return { ok: true, normalised: value }
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface Gs1KeyInput {
  /** The primary key's AI: `01`, `00`, `414`, … */
  ai: string
  value: string
  /** Qualifier values by AI. Ordered by the standard, never by the caller. */
  qualifiers?: Record<string, string>
}

export class Gs1KeyError extends Error {
  /** Which field the message is about, so a form can point at it. */
  readonly ai: string | null
  constructor(message: string, ai: string | null = null) {
    super(message)
    this.name = 'Gs1KeyError'
    this.ai = ai
  }
}

function checkQualifier(primary: Gs1PrimaryKey, ai: string, raw: string): string {
  const spec = QUALIFIERS[ai]
  if (!spec || !primary.qualifiers.includes(ai)) {
    throw new Gs1KeyError(`A ${primary.label} link has no ${ai} qualifier.`, ai)
  }
  const value = raw.trim()
  if (!value) throw new Gs1KeyError(`${spec.label} is empty.`, ai)
  if (value.length > spec.maxLength) {
    throw new Gs1KeyError(`${spec.label} is at most ${spec.maxLength} characters.`, ai)
  }
  if (spec.digits && !/^\d+$/.test(value)) {
    throw new Gs1KeyError(`${spec.label} is digits only.`, ai)
  }
  if (!XCHAR.test(value)) {
    throw new Gs1KeyError(`${spec.label} contains a character a scanner cannot carry.`, ai)
  }
  return value
}

/**
 * The path for a key, with a leading slash and no trailing one:
 * `/01/09506000134352/21/A1B2`.
 *
 * This string is the address *and* the index. Two links that mean the same
 * item have to produce the same characters here, so the value is normalised,
 * the qualifiers are emitted in the standard's order rather than the caller's,
 * and a qualifier that does not belong to this key is refused rather than
 * dropped — dropping it would silently point two different items at one
 * destination.
 */
export function gs1KeyPath(input: Gs1KeyInput): string {
  const ai = input.ai.trim()
  const primary = PRIMARY_KEYS[ai]
  if (!primary) {
    throw new Gs1KeyError(
      `${ai || 'That'} is not a supported GS1 primary key. Use one of: ${PRIMARY_KEY_AIS.join(', ')}.`,
      null,
    )
  }

  const checked = checkGs1Key(ai, input.value)
  if (!checked.ok || !checked.normalised) {
    throw new Gs1KeyError(checked.message ?? `That ${primary.label} is not valid.`, ai)
  }

  const given = input.qualifiers ?? {}
  for (const key of Object.keys(given)) {
    if (given[key]?.trim() && !primary.qualifiers.includes(key)) {
      throw new Gs1KeyError(
        `A ${primary.label} link takes ${
          primary.qualifiers.length === 0
            ? 'no qualifiers'
            : `only ${primary.qualifiers.join(', ')} after it`
        }, not ${key}.`,
        key,
      )
    }
  }

  const path: string[] = [ai, encodeSegment(checked.normalised)]
  for (const qualifier of primary.qualifiers) {
    const raw = given[qualifier]
    if (raw === undefined || raw.trim() === '') continue
    path.push(qualifier, encodeSegment(checkQualifier(primary, qualifier, raw)))
  }

  return `/${path.join('/')}`
}

export interface Gs1ParsedPath {
  ai: string
  value: string
  qualifiers: Record<string, string>
}

/**
 * Read a path back into its parts, or null when it is not one.
 *
 * Deliberately strict, because this decides what a scan resolves to: the
 * segments must pair up, the first pair must be a primary key, and each
 * qualifier must be one this key allows *and* must come after the ones before
 * it in the standard's order. Anything else is not a Digital Link path, and
 * saying so beats guessing.
 */
export function parseGs1KeyPath(pathname: string): Gs1ParsedPath | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2 || segments.length % 2 !== 0) return null

  const ai = segments[0]!
  const primary = PRIMARY_KEYS[ai]
  if (!primary) return null

  let value: string
  try {
    value = decodeURIComponent(segments[1]!)
  } catch {
    return null
  }
  const checked = checkGs1Key(ai, value)
  if (!checked.ok || !checked.normalised) return null

  const qualifiers: Record<string, string> = {}
  let at = 0
  for (let i = 2; i < segments.length; i += 2) {
    const qualifier = segments[i]!
    const next = primary.qualifiers.indexOf(qualifier)
    // Unknown here, out of order, or repeated: one answer for all three.
    if (next < at) return null
    at = next + 1
    try {
      const decoded = decodeURIComponent(segments[i + 1]!)
      if (!decoded) return null
      qualifiers[qualifier] = decoded
    } catch {
      return null
    }
  }

  return { ai, value: checked.normalised, qualifiers }
}

/**
 * The path for a URI somebody pasted, or null.
 *
 * Used to turn "here is the Digital Link on my pack" into the key we look up,
 * so it tolerates the domain path prefix the standard allows before the AI
 * segments and finds the primary key wherever it starts.
 */
export function gs1PathFromUri(uri: string): string | null {
  let pathname: string
  try {
    pathname = new URL(uri).pathname
  } catch {
    pathname = uri
  }
  const segments = pathname.split('/').filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    if (!PRIMARY_KEYS[segments[i]!]) continue
    const parsed = parseGs1KeyPath(segments.slice(i).join('/'))
    if (parsed) {
      return gs1KeyPath({ ai: parsed.ai, value: parsed.value, qualifiers: parsed.qualifiers })
    }
  }
  return null
}

/** How a key reads to a person: `GTIN 09506000134352, Batch or lot LOT7`. */
export function describeGs1Path(path: string): string {
  const parsed = parseGs1KeyPath(path)
  if (!parsed) return path
  const parts = [`${PRIMARY_KEYS[parsed.ai]!.label} ${parsed.value}`]
  for (const [ai, value] of Object.entries(parsed.qualifiers)) {
    parts.push(`${QUALIFIERS[ai]?.label ?? ai} ${value}`)
  }
  return parts.join(', ')
}
