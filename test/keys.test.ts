import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GROUP_SEPARATOR as GS,
  Gs1KeyError,
  checkGs1Key,
  describeGs1Path,
  gs1KeyPath,
  gs1PathFromUri,
  parseElementString,
  parseGs1KeyPath,
  readGs1,
} from '../src/index.ts'

/**
 * The GS1 rules, tested where they are cheapest to test: as strings.
 *
 * Every one of these is a rule from the URI Syntax standard or the General
 * Specifications, and every one of them fails silently in production if it is
 * wrong — a check digit nobody notices until a till rejects a pallet, a
 * qualifier order nobody notices until two links exist for one item.
 */

test('a GTIN is checked, and the refusal names the digit it should have ended in', () => {
  // 5012345678900 is a valid GTIN-13; every other last digit is not.
  assert.equal(checkGs1Key('01', '5012345678900').normalised, '05012345678900')
  assert.equal(checkGs1Key('01', '05012345678900').normalised, '05012345678900')
  assert.equal(checkGs1Key('01', '501234-567 8900').normalised, '05012345678900')

  const wrong = checkGs1Key('01', '5012345678905')
  assert.equal(wrong.ok, false)
  assert.match(wrong.message!, /should end in 0, not 5/)

  // A transposed pair — the error the check digit exists for.
  assert.equal(checkGs1Key('01', '5012345678090').ok, false)

  assert.match(checkGs1Key('01', '50123456789').message!, /8, 12, 13 or 14 digits/)
  assert.match(checkGs1Key('01', '50123456789ab').message!, /digits only/)
  assert.match(checkGs1Key('01', '').message!, /Enter a GTIN/)
})

test('the check digit weighting works for every length, not only thirteen', () => {
  // The weights alternate from the right, so an odd-length and an even-length
  // key start on different weights. Hard-coding one vector breaks the other.
  for (const gtin of ['95050003', '036000291452', '5012345678900', '15012345678907']) {
    assert.equal(checkGs1Key('01', gtin).ok, true, gtin)
  }
  assert.equal(checkGs1Key('00', '106141411234567897').ok, true)
  assert.equal(checkGs1Key('414', '5012345678900').ok, true)
  assert.match(checkGs1Key('00', '106141411234567890').message!, /should end in 7, not 0/)
  assert.match(checkGs1Key('00', '10614141123456789').message!, /18 digits/)
})

test('a key whose check digit sits inside it is checked where it actually is', () => {
  // GDTI: thirteen digits carrying the check digit, then the document serial.
  assert.equal(checkGs1Key('253', '5012345678900').ok, true)
  assert.equal(checkGs1Key('253', '5012345678900INVOICE7').ok, true)
  assert.match(checkGs1Key('253', '5012345678905X').message!, /should end in 0, not 5/)

  // GRAI: a literal zero, then the thirteen.
  assert.equal(checkGs1Key('8003', '05012345678900CRATE9').ok, true)
  assert.match(checkGs1Key('8003', '5012345678900').message!, /starts with a zero/)

  // ITIP: eighteen digits whose fourteenth is the GTIN's check digit.
  assert.equal(checkGs1Key('8006', '050123456789000102').ok, true)
  assert.match(checkGs1Key('8006', '050123456789050102').message!, /should end in 0, not 5/)

  // GIAI and GINC carry no check digit at all, and inventing one would refuse
  // valid asset numbers.
  assert.equal(checkGs1Key('8004', '5012345ASSET-7').ok, true)
  assert.equal(checkGs1Key('401', 'CONSIGNMENT-2026-09').ok, true)
  assert.match(checkGs1Key('8004', 'ASSET 7').message!, /character a GS1 symbol cannot carry/)
})

test('qualifiers come out in the standard’s order, whatever order they went in', () => {
  const path = gs1KeyPath({
    ai: '01',
    value: '5012345678900',
    qualifiers: { '21': 'SER1', '10': 'LOT7', '22': 'V2' },
  })
  assert.equal(path, '/01/05012345678900/22/V2/10/LOT7/21/SER1')

  // Each is independently optional: a serial with no batch is valid.
  assert.equal(
    gs1KeyPath({ ai: '01', value: '5012345678900', qualifiers: { '21': 'SER1' } }),
    '/01/05012345678900/21/SER1',
  )
  // An empty one is not a qualifier.
  assert.equal(
    gs1KeyPath({ ai: '01', value: '5012345678900', qualifiers: { '10': '  ' } }),
    '/01/05012345678900',
  )
})

test('a qualifier that does not belong to the key is refused, never dropped', () => {
  // Dropping it would point two different items at one destination.
  assert.throws(
    () => gs1KeyPath({ ai: '00', value: '106141411234567897', qualifiers: { '10': 'LOT7' } }),
    (e: unknown) => e instanceof Gs1KeyError && /no qualifiers/.test(e.message),
  )
  assert.throws(
    () => gs1KeyPath({ ai: '01', value: '5012345678900', qualifiers: { '8019': '4' } }),
    (e: unknown) => e instanceof Gs1KeyError && e.ai === '8019',
  )
  assert.throws(
    () => gs1KeyPath({ ai: '99', value: '1' }),
    (e: unknown) => e instanceof Gs1KeyError && /not a supported GS1 primary key/.test(e.message),
  )
})

test('a value is percent-encoded the way the standard asks, including the four escapes browsers skip', () => {
  const path = gs1KeyPath({ ai: '414', value: '5012345678900', qualifiers: { '254': "32a/b(c)*'!" } })
  assert.equal(path, '/414/5012345678900/254/32a%2Fb%28c%29%2A%27%21')
  // And it reads back as what went in.
  assert.equal(parseGs1KeyPath(path)?.qualifiers['254'], "32a/b(c)*'!")
})

test('a path is read back strictly: pairs, a known key, and qualifiers in order', () => {
  const parsed = parseGs1KeyPath('/01/05012345678900/10/LOT7/21/SER1')
  assert.equal(parsed?.ai, '01')
  assert.deepEqual(parsed?.qualifiers, { '10': 'LOT7', '21': 'SER1' })

  assert.equal(parseGs1KeyPath('/01/05012345678900/10'), null, 'an odd number of segments')
  assert.equal(parseGs1KeyPath('/01/05012345678900/21/SER1/10/LOT7'), null, 'out of order')
  assert.equal(parseGs1KeyPath('/01/05012345678900/10/A/10/B'), null, 'repeated')
  assert.equal(parseGs1KeyPath('/01/05012345678905'), null, 'a wrong check digit is not an address')
  assert.equal(parseGs1KeyPath('/spring-menu'), null)
  assert.equal(parseGs1KeyPath('/99/1234'), null)
})

test('a Digital Link somebody pastes becomes the one spelling we store', () => {
  // The standard allows a path prefix before the AI segments, and a GTIN-13
  // and its padded GTIN-14 are one product.
  for (const uri of [
    'https://example.com/01/05012345678900/21/SER1',
    'https://example.com/products/01/5012345678900/21/SER1',
    'http://brand.example/01/5012345678900/21/SER1?17=261231',
    '/01/05012345678900/21/SER1',
  ]) {
    assert.equal(gs1PathFromUri(uri), '/01/05012345678900/21/SER1', uri)
  }
  assert.equal(gs1PathFromUri('https://example.com/spring-menu'), null)
  assert.match(describeGs1Path('/01/05012345678900/10/LOT7'), /GTIN 05012345678900, Batch or lot LOT7/)
})

// ---------------------------------------------------------------------------
// Element strings
// ---------------------------------------------------------------------------

test('an element string splits on predefined lengths and separators', () => {
  // A GTIN is a predefined-length field, so no separator follows it; a batch
  // is not, so one does.
  const elements = parseElementString(`010950600013435210LOT7${GS}21SER1`)
  assert.deepEqual(
    elements?.map((e) => [e.ai, e.value]),
    [
      ['01', '09506000134352'],
      ['10', 'LOT7'],
      ['21', 'SER1'],
    ],
  )
  assert.equal(elements?.[0]?.label, 'GTIN')

  // A four-digit AI, and a date, both predefined.
  const weighed = parseElementString('0109506000134352172612313103000123')
  assert.deepEqual(
    weighed?.map((e) => e.ai),
    ['01', '17', '3103'],
  )
  assert.equal(weighed?.[2]?.value, '000123')

  // A symbology identifier in front of the data is not part of it.
  assert.equal(parseElementString(']C10109506000134352')?.[0]?.value, '09506000134352')
  // Some readers print the separator rather than emitting it.
  assert.equal(parseElementString('0109506000134352{GS}10LOT7')?.length, 2)

  assert.equal(parseElementString('not a code'), null)
  assert.equal(parseElementString('0109506'), null, 'a field that runs off the end')
  assert.equal(parseElementString(''), null)
})

test('the reader names the key in both notations, and refuses anything else', () => {
  const link = readGs1('https://example.com/01/09506000134352/10/LOT7?17=261231')
  assert.equal(link?.form, 'digital-link')
  assert.deepEqual(link?.primary, { ai: '01', value: '09506000134352', label: 'GTIN' })
  assert.deepEqual(
    link?.elements.map((e) => [e.ai, e.value]),
    [
      ['01', '09506000134352'],
      ['10', 'LOT7'],
      ['17', '261231'],
    ],
  )

  // An attribute in the query string is named, not just numbered: somebody
  // scanning a pack has to see "Expiry date" rather than a bare 17.
  assert.deepEqual(
    link?.elements.map((e) => e.label),
    ['GTIN', 'Batch or lot', 'Expiry date'],
  )
  const dates = readGs1('https://example.com/01/09506000134352?17=261231&11=260102')
  assert.deepEqual(
    dates?.elements.map((e) => [e.ai, e.label]),
    [
      ['01', 'GTIN'],
      ['17', 'Expiry date'],
      ['11', 'Production date'],
    ],
  )

  const carton = readGs1(`00106141411234567897${GS}0209506000134352`)
  assert.equal(carton?.form, 'element-string')
  assert.equal(carton?.primary?.label, 'SSCC')

  // Plain content is not GS1 and must not be made to look like it.
  assert.equal(readGs1('https://example.com/spring-menu'), null)
  assert.equal(readGs1('Hello'), null)
  assert.equal(readGs1('WIFI:S:Cafe;T:WPA;P:hunter2;;'), null)
})
