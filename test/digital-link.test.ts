import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  Gs1Error,
  checkGtin,
  encodeGs1DigitalLink,
  gtinCheckDigit,
  parseGs1DigitalLink,
  toGs1Date,
} from '../src/index.ts'

// GS1's own published examples. If these drift, the encoder is wrong, not the
// test — every one of them is a number a real scanner has to accept.
const VALID_GTINS = [
  '09506000134352', // GS1 Digital Link specification example
  '0614141000036', // GS1 General Specifications example
  '95050003', // GTIN-8
  '012345678905', // GTIN-12
]

test('check digits match the GS1 examples', () => {
  for (const gtin of VALID_GTINS) {
    const result = checkGtin(gtin)
    assert.ok(result.ok, `${gtin} should be valid: ${result.message ?? ''}`)
  }
})

test('the check digit is computed, not assumed', () => {
  // Worked by hand from the specification example.
  assert.equal(gtinCheckDigit('0950600013435'), 2)
  assert.equal(gtinCheckDigit('061414100003'), 6)
})

test('a transposed pair is caught and the right digit is named', () => {
  // 09506000134352 with the last two body digits swapped.
  const result = checkGtin('09506000134325')
  assert.equal(result.ok, false)
  assert.equal(typeof result.expected, 'number')
  assert.match(result.message ?? '', /should end in/)
})

test('lengths that are not a GTIN are rejected by length, not by check digit', () => {
  const result = checkGtin('12345')
  assert.equal(result.ok, false)
  assert.match(result.message ?? '', /8, 12, 13 or 14 digits/)
})

test('every accepted length normalises to 14 digits', () => {
  for (const gtin of VALID_GTINS) {
    const { normalised } = checkGtin(gtin)
    assert.equal(normalised?.length, 14, gtin)
    // Padding must not change the number, only its width.
    assert.equal(Number(normalised), Number(gtin))
  }
})

test('the canonical example encodes exactly as GS1 publishes it', () => {
  assert.equal(
    encodeGs1DigitalLink({ domain: 'example.com', gtin: '09506000134352' }),
    'https://example.com/01/09506000134352',
  )
})

test('qualifiers go in the defined order, not the order they were passed', () => {
  const uri = encodeGs1DigitalLink({
    domain: 'brand.example',
    gtin: '09506000134352',
    serial: 'S99',
    batch: 'B42',
  })
  // Batch (10) before serial (21) is what a positional scanner expects.
  assert.equal(uri, 'https://brand.example/01/09506000134352/10/B42/21/S99')
})

test('dates become query parameters in YYMMDD', () => {
  const uri = encodeGs1DigitalLink({
    domain: 'brand.example',
    gtin: '09506000134352',
    expiry: '2026-12-31',
  })
  assert.equal(uri, 'https://brand.example/01/09506000134352?17=261231')
})

test('an existing path on the domain is preserved', () => {
  const uri = encodeGs1DigitalLink({
    domain: 'https://brand.example/products/',
    gtin: '09506000134352',
  })
  assert.equal(uri, 'https://brand.example/products/01/09506000134352')
})

test('http is upgraded, because a Digital Link is defined over https', () => {
  const uri = encodeGs1DigitalLink({ domain: 'http://brand.example', gtin: '09506000134352' })
  assert.match(uri, /^https:\/\//)
})

test('a batch containing a slash cannot break out of its segment', () => {
  const uri = encodeGs1DigitalLink({
    domain: 'brand.example',
    gtin: '09506000134352',
    batch: 'A/21',
  })
  assert.equal(uri, 'https://brand.example/01/09506000134352/10/A%2F21')
  // And it must survive the round trip intact.
  assert.equal(parseGs1DigitalLink(uri)?.values['10'], 'A/21')
})

test('characters encodeURIComponent leaves alone are still escaped', () => {
  const uri = encodeGs1DigitalLink({
    domain: 'brand.example',
    gtin: '09506000134352',
    batch: "a'b(c)",
  })
  assert.ok(!uri.includes("'"), uri)
  assert.ok(!uri.includes('('), uri)
  assert.equal(parseGs1DigitalLink(uri)?.values['10'], "a'b(c)")
})

test('a bad GTIN throws naming the field', () => {
  assert.throws(
    () => encodeGs1DigitalLink({ domain: 'brand.example', gtin: '09506000134353' }),
    (error: unknown) => error instanceof Gs1Error && error.ai === '01',
  )
})

test('an over-long batch throws naming the field', () => {
  assert.throws(
    () =>
      encodeGs1DigitalLink({
        domain: 'brand.example',
        gtin: '09506000134352',
        batch: 'x'.repeat(21),
      }),
    (error: unknown) => error instanceof Gs1Error && error.ai === '10',
  )
})

test('round trip through parse returns what went in', () => {
  const input = {
    domain: 'https://brand.example',
    gtin: '09506000134352',
    batch: 'B42',
    serial: 'S99',
    expiry: '2026-12-31',
  }
  const parsed = parseGs1DigitalLink(encodeGs1DigitalLink(input))
  assert.equal(parsed?.domain, 'https://brand.example')
  assert.deepEqual(parsed?.values, {
    '01': '09506000134352',
    '10': 'B42',
    '21': 'S99',
    '17': '261231',
  })
})

test('an ordinary URL parses as not a Digital Link, rather than throwing', () => {
  assert.equal(parseGs1DigitalLink('https://example.com/menu'), null)
  assert.equal(parseGs1DigitalLink('not a url'), null)
  // A path that merely looks numeric is not a GTIN segment.
  assert.equal(parseGs1DigitalLink('https://example.com/99/123'), null)
})

test('dates accept both the ISO and the GS1 form', () => {
  assert.equal(toGs1Date('2026-12-31'), '261231')
  assert.equal(toGs1Date('261231'), '261231')
  assert.equal(toGs1Date('nonsense'), null)
})

test('a date that is not a date is refused rather than printed', () => {
  // Six digits is not enough: a till reads AI 17 as YYMMDD and acts on it.
  assert.equal(toGs1Date('271345'), null, 'month 13')
  assert.equal(toGs1Date('2027-13-45'), null, 'the same, typed as ISO')
  assert.equal(toGs1Date('270230'), null, '30 February')
  assert.equal(toGs1Date('270000'), null, 'month 00')

  // The one zero the specification does allow: day 00 means end of month.
  assert.equal(toGs1Date('271200'), '271200')
  // A leap day in a leap year, and the same date in one that is not.
  assert.equal(toGs1Date('280229'), '280229')
  assert.equal(toGs1Date('270229'), null)

  // And it is refused at the encoder, naming the field.
  assert.throws(
    () => encodeGs1DigitalLink({ domain: 'brand.example', gtin: '09506000134352', expiry: '2027-13-45' }),
    (e: unknown) => e instanceof Gs1Error && e.ai === '17',
  )
})
