import { gtinCheckDigit } from './check-digit.ts'
import { encodeSegment } from './percent-encode.ts'

/**
 * Encoding and parsing a GS1 Digital Link URI.
 *
 * A Digital Link is a URL shaped so a scanner can read the GTIN out of the path
 * and a phone can simply open it. The syntax is a sequence of `/{ai}/{value}`
 * segments for the identifying keys, then the remaining data as query
 * parameters:
 *
 *     https://example.com/01/09506000134352/10/ABC123?17=261231
 *
 * The numbers are GS1 Application Identifiers: 01 is the GTIN, 10 a batch, 21 a
 * serial, 17 an expiry, 11 a production date. This module covers that set — the
 * one a consumer-facing pack actually carries. For the wider key space, and for
 * reading a path back strictly, see `keys.ts`.
 *
 * Reference: GS1 Digital Link URI Syntax 1.7.0 (ratified August 2026), and the
 * GS1 General Specifications for the AI formats.
 */

// ---------------------------------------------------------------------------
// Application identifiers
// ---------------------------------------------------------------------------

/**
 * The AIs this encoder writes.
 *
 * Deliberately a short list. GS1 defines over a hundred, most of them for
 * logistics units nobody puts a consumer-facing code on, and every one accepted
 * is one that has to be validated correctly. These five cover the packaging
 * case: what the item is, which batch, which unit, and the two dates.
 */
export const GS1_KEYS = ['01', '10', '21', '17', '11'] as const
export type Gs1Key = (typeof GS1_KEYS)[number]

export interface Gs1AiSpec {
  ai: Gs1Key
  label: string
  hint: string
  /** Path segment (an identifying key) or query parameter (an attribute). */
  position: 'path' | 'query'
  maxLength: number
  /** GS1 date attributes are YYMMDD, not ISO. */
  kind: 'digits' | 'alnum' | 'date'
}

export const GS1_AIS: Record<Gs1Key, Gs1AiSpec> = {
  '01': {
    ai: '01',
    label: 'GTIN',
    hint: 'The 8, 12, 13 or 14 digit number under the barcode.',
    position: 'path',
    maxLength: 14,
    kind: 'digits',
  },
  '10': {
    ai: '10',
    label: 'Batch or lot',
    hint: 'Up to 20 characters. Letters and digits.',
    position: 'path',
    maxLength: 20,
    kind: 'alnum',
  },
  '21': {
    ai: '21',
    label: 'Serial number',
    hint: 'Up to 20 characters, unique per item.',
    position: 'path',
    maxLength: 20,
    kind: 'alnum',
  },
  '17': {
    ai: '17',
    label: 'Expiry date',
    hint: 'The date the product expires.',
    position: 'query',
    maxLength: 6,
    kind: 'date',
  },
  '11': {
    ai: '11',
    label: 'Production date',
    hint: 'The date the product was made.',
    position: 'query',
    maxLength: 6,
    kind: 'date',
  },
}

/**
 * Order matters and is not alphabetical.
 *
 * GS1 requires the primary key first and the qualifiers in a fixed sequence,
 * because a scanner reads the path positionally. Batch before serial is the
 * defined order for a GTIN, and swapping them produces a URI that looks fine
 * and parses wrong.
 */
const PATH_ORDER: Gs1Key[] = ['01', '10', '21']
const QUERY_ORDER: Gs1Key[] = ['17', '11']

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class Gs1Error extends Error {
  readonly ai: Gs1Key | null
  constructor(message: string, ai: Gs1Key | null = null) {
    super(message)
    this.name = 'Gs1Error'
    this.ai = ai
  }
}

export interface GtinCheck {
  ok: boolean
  /** Zero-padded to 14, which is the form a Digital Link carries. */
  normalised: string | null
  message?: string
  /** What the last digit should have been, when it is wrong. */
  expected?: number
}

/**
 * Validate and normalise a GTIN.
 *
 * GTIN-8, 12, 13 and 14 are the same number with different leading zeros, and
 * a Digital Link always carries 14. Normalising here means the rest of the
 * system never has to care which length was typed.
 */
export function checkGtin(raw: string): GtinCheck {
  const digits = raw.replace(/[\s-]/g, '')
  if (!digits) return { ok: false, normalised: null, message: 'Enter a GTIN.' }
  if (!/^\d+$/.test(digits)) {
    return { ok: false, normalised: null, message: 'A GTIN is digits only.' }
  }
  if (![8, 12, 13, 14].includes(digits.length)) {
    return {
      ok: false,
      normalised: null,
      message: `A GTIN is 8, 12, 13 or 14 digits. That is ${digits.length}.`,
    }
  }

  const body = digits.slice(0, -1)
  const given = Number(digits.slice(-1))
  const expected = gtinCheckDigit(body)
  if (given !== expected) {
    return {
      ok: false,
      normalised: null,
      expected,
      message: `Check digit is wrong: this number should end in ${expected}, not ${given}. Retype it — a swapped pair of digits is the usual cause.`,
    }
  }

  return { ok: true, normalised: digits.padStart(14, '0') }
}

/**
 * Is a YYMMDD string a date the General Specifications allow?
 *
 * Month is 01-12 and day is 01 to the length of that month, with the one
 * exception the specification makes: `00` as the day means "the end of the
 * month", which is how a best-before is printed when only the month matters.
 * The century is read the way GS1 reads it — a two-digit year is within fifty
 * years of now — which only matters here for deciding whether February has 29
 * days.
 *
 * Worth the arithmetic for the same reason the check digit is: a date that is
 * not a date is invisible on screen, survives the print run, and is read back
 * by a till as rubbish. `17` is the AI a pharmacy and a supermarket both act
 * on.
 */
function isGs1Date(yymmdd: string): boolean {
  const year = Number(yymmdd.slice(0, 2))
  const month = Number(yymmdd.slice(2, 4))
  const day = Number(yymmdd.slice(4, 6))
  if (month < 1 || month > 12) return false
  if (day === 0) return true

  // GS1's own rule for a two-digit year: the one within the fifty years either
  // side of today. Only February's length depends on it.
  const thisYear = new Date().getUTCFullYear()
  const century = Math.floor(thisYear / 100) * 100
  let full = century + year
  if (full - thisYear > 50) full -= 100
  else if (thisYear - full > 50) full += 100

  const days = new Date(Date.UTC(full, month, 0)).getUTCDate()
  return day <= days
}

/**
 * GS1 dates are YYMMDD. Accepts an ISO date and converts.
 *
 * Null for anything that is not a real date, including a well-formed six
 * digits naming a thirteenth month.
 */
export function toGs1Date(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (iso) {
    const [, y, m, d] = iso
    const compact = `${y!.slice(2)}${m}${d}`
    return isGs1Date(compact) ? compact : null
  }
  const compact = value.trim().replace(/\D/g, '')
  return /^\d{6}$/.test(compact) && isGs1Date(compact) ? compact : null
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface Gs1Input {
  /** Where the link resolves. Usually the brand's own domain. */
  domain: string
  gtin: string
  batch?: string | null
  serial?: string | null
  /** ISO `YYYY-MM-DD` or GS1 `YYMMDD`. */
  expiry?: string | null
  production?: string | null
}

function validateValue(ai: Gs1Key, raw: string): string {
  const spec = GS1_AIS[ai]
  const value = raw.trim()

  // Dates are converted before they are measured. `maxLength` describes the
  // GS1 form (YYMMDD, six characters) but the field accepts an ISO date, which
  // is ten - measuring first rejected every valid date typed into a date input.
  if (spec.kind === 'date') {
    const date = toGs1Date(value)
    if (!date) throw new Gs1Error(`${spec.label} must be a date.`, ai)
    return date
  }

  if (value.length > spec.maxLength) {
    throw new Gs1Error(`${spec.label} is at most ${spec.maxLength} characters.`, ai)
  }
  if (spec.kind === 'digits' && !/^\d+$/.test(value)) {
    throw new Gs1Error(`${spec.label} is digits only.`, ai)
  }
  // GS1 permits the 82-character subset here; the printable-ASCII check below
  // is what actually matters, since anything outside it will not survive a
  // scanner's character set.
  if (spec.kind === 'alnum' && !/^[\x21-\x7E]+$/.test(value)) {
    throw new Gs1Error(`${spec.label} contains a character a scanner cannot carry.`, ai)
  }
  return value
}

/** Normalise a bare host or a full URL down to `https://host[/path]`. */
function normaliseDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Gs1Error('Enter the domain the code should resolve to.')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Gs1Error('That is not a valid domain.')
  }
  // GS1 Digital Link is defined over https. A http:// link still scans, but it
  // will be flagged by a phone before the customer sees the page.
  url.protocol = 'https:'
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Build a GS1 Digital Link URI.
 *
 * Throws `Gs1Error` naming the field, because every one of these errors is a
 * person mistyping a number off a pack and the only useful message says which
 * number and what was wrong with it.
 */
export function encodeGs1DigitalLink(input: Gs1Input): string {
  const base = normaliseDomain(input.domain)

  const gtin = checkGtin(input.gtin)
  if (!gtin.ok || !gtin.normalised) {
    throw new Gs1Error(gtin.message ?? 'That GTIN is not valid.', '01')
  }

  const values: Partial<Record<Gs1Key, string>> = {
    '01': gtin.normalised,
    ...(input.batch?.trim() ? { '10': validateValue('10', input.batch) } : {}),
    ...(input.serial?.trim() ? { '21': validateValue('21', input.serial) } : {}),
    ...(input.expiry?.trim() ? { '17': validateValue('17', input.expiry) } : {}),
    ...(input.production?.trim() ? { '11': validateValue('11', input.production) } : {}),
  }

  const path = PATH_ORDER.filter((ai) => values[ai] !== undefined)
    .map((ai) => `/${ai}/${encodeSegment(values[ai]!)}`)
    .join('')

  const query = QUERY_ORDER.filter((ai) => values[ai] !== undefined)
    .map((ai) => `${ai}=${encodeSegment(values[ai]!)}`)
    .join('&')

  return `${base}${path}${query ? `?${query}` : ''}`
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface Gs1Parsed {
  domain: string
  values: Partial<Record<Gs1Key, string>>
}

/**
 * Read a Digital Link back apart, so one can be round-tripped.
 *
 * Returns null rather than throwing: it is meant to be run against arbitrary
 * URLs, most of which are not Digital Links at all.
 */
export function parseGs1DigitalLink(uri: string): Gs1Parsed | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const values: Partial<Record<Gs1Key, string>> = {}
  let i = segments.length

  // Walk back from the end: the AI pairs are the tail of the path, and
  // anything before them belongs to the domain's own path.
  while (i >= 2) {
    const ai = segments[i - 2]
    const value = segments[i - 1]
    if (!ai || !value || !(GS1_KEYS as readonly string[]).includes(ai)) break
    if (GS1_AIS[ai as Gs1Key].position !== 'path') break
    values[ai as Gs1Key] = decodeURIComponent(value)
    i -= 2
  }

  if (values['01'] === undefined) return null

  for (const ai of QUERY_ORDER) {
    const value = url.searchParams.get(ai)
    if (value) values[ai] = value
  }

  const prefix = segments.slice(0, i).join('/')
  return {
    domain: `${url.origin}${prefix ? `/${prefix}` : ''}`,
    values,
  }
}
