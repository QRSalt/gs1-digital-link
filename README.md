# gs1-digital-link

Encode, parse and validate GS1 Digital Link URIs and GS1 element strings, in
TypeScript, with no dependencies.

```
npm install gs1-digital-link
```

Ships as ESM and CommonJS with type declarations, and runs in Node 18+ and
browsers.

```ts
import { readGs1 } from 'gs1-digital-link'        // ESM / TypeScript
const { readGs1 } = require('gs1-digital-link')   // CommonJS
```

To try it without code, the [GS1 Digital Link generator](https://qrsalt.com/barcode-generator)
builds and reads the same URIs in the browser.

## What a GS1 Digital Link is

The barcode on a retail pack is being replaced. GS1 expects retailers to accept
a 2D code at the till, and the content of that code is not a number but a URL
shaped so a scanner can read the GTIN straight out of the path while a phone can
simply open it:

```
https://example.com/01/09506000134352/10/ABC123?17=261231
```

The numbers are GS1 Application Identifiers. `01` is the GTIN, `10` a batch,
`21` a serial, `17` an expiry date. Identifying keys and their qualifiers go in
the path, in an order the grammar fixes; everything else goes in the query
string.

The older notation — what a GS1-128 or a GS1 DataMatrix on a carton carries — is
an *element string*: one run of characters with an invisible group separator
(ASCII 29) wherever a variable-length field ends. This library reads both.

## What it does

- Builds a Digital Link URI from a GTIN, a batch, a serial and dates, with the
  path segments in the order the standard requires.
- Parses a Digital Link URI back into its parts, tolerating a path prefix in
  front of the AI segments.
- Builds and parses the canonical key path for the wider key space — SSCC, GLN,
  GDTI, GCN, GINC, GSIN, GRAI, GIAI, ITIP, CPID, GMN, GSRN — which is what a
  resolver indexes links by.
- Splits a GS1 element string into its AIs, using the predefined-length table
  and the group separator.
- Validates check digits. Every numeric key whose check digit the General
  Specifications define is verified, not merely shaped: GTIN-8/12/13/14, SSCC,
  GLN, GSIN, GSRN, and the thirteen-digit head of a GDTI, GCN or GRAI. A wrong
  check digit is refused, and the message names the digit the number should have
  ended in, because a transposed pair is the commonest way a number is copied
  wrong off a pack.

## What it does not do

- **No resolution.** Nothing here fetches a URL, follows a link, or talks to a
  GS1 resolver. It is string and arithmetic work only.
- **No barcode rendering.** It produces the string that goes inside a symbol,
  not the symbol.
- **No compressed Digital Link.** The standard's compressed URI form is not
  implemented in either direction.
- **No linkset or link type handling.** `?linkType=gs1:pip` and the resolver
  description files are out of scope.
- **Three grammars are left out on purpose**, because each makes a qualifier
  mandatory and half-supporting one is worse than not offering it: AI `415`
  pay-to GLN with its `8020` payment slip reference, the EOID/FID/MID forms that
  require the `7040` UIC extension, and AI `235` TPX, which replaces the
  CPV/batch/serial sequence after a GTIN rather than joining it.
- **The GMN check character pair is not verified.** It is a modulo-1021 pair
  over the 82-character set, not the modulo-10 digit every other key uses. Its
  length and character set are checked; the pair itself is not.
- **ISBN-10 is not a GTIN.** `gtinCheckDigit` returns a plausible, wrong answer
  for one. Use a modulo-11 routine.

A Digital Link on your own domain is a conformant URI and is never a *canonical*
one — canonical means `https://id.gs1.org/…` by definition. This library never
claims otherwise, and nor should anything built on it.

## Usage

### `encodeGs1DigitalLink(input)`

```ts
encodeGs1DigitalLink(input: {
  domain: string
  gtin: string
  batch?: string | null
  serial?: string | null
  expiry?: string | null      // ISO YYYY-MM-DD or GS1 YYMMDD
  production?: string | null
}): string
```

Throws `Gs1Error` (with `.ai` naming the field) when a value is wrong.

```ts
import { encodeGs1DigitalLink } from 'gs1-digital-link'

encodeGs1DigitalLink({
  domain: 'brand.example',
  gtin: '09506000134352',
  batch: 'B42',
  serial: 'S99',
  expiry: '2026-12-31',
})
// 'https://brand.example/01/09506000134352/10/B42/21/S99?17=261231'
```

### `parseGs1DigitalLink(uri)`

Returns `{ domain, values }`, or `null` for a URL that is not a Digital Link.

```ts
import { parseGs1DigitalLink } from 'gs1-digital-link'

parseGs1DigitalLink('https://brand.example/shop/01/09506000134352/10/A%2F21')
// { domain: 'https://brand.example/shop', values: { '01': '09506000134352', '10': 'A/21' } }

parseGs1DigitalLink('https://brand.example/spring-menu')
// null
```

### `checkGtin(raw)`

Validates and normalises a GTIN to the fourteen digits a Digital Link carries.
Spaces and hyphens are ignored, since that is how a GTIN is printed.

```ts
import { checkGtin } from 'gs1-digital-link'

checkGtin('5012345678900')
// { ok: true, normalised: '05012345678900' }

checkGtin('09506000134325')
// { ok: false, normalised: null, expected: 1,
//   message: 'Check digit is wrong: this number should end in 1, not 5. …' }
```

### `gtinCheckDigit(digitsWithoutCheck)`

The modulo-10 check digit for a key's body, weights alternating 3 and 1 from the
right.

```ts
import { gtinCheckDigit } from 'gs1-digital-link'

gtinCheckDigit('0950600013435') // 2
```

### `toGs1Date(value)`

An ISO date or a six-digit GS1 date in, `YYMMDD` or `null` out. A day of `00`
means "end of the month", which the specification allows; a thirteenth month or
a 29 February in a common year does not.

```ts
import { toGs1Date } from 'gs1-digital-link'

toGs1Date('2026-12-31') // '261231'
toGs1Date('271200')     // '271200'
toGs1Date('270230')     // null
```

### `checkGs1Key(ai, raw)`

Validates one primary key's value and returns the single spelling to store it
under.

```ts
import { checkGs1Key } from 'gs1-digital-link'

checkGs1Key('01', '501234-567 8900')  // { ok: true, normalised: '05012345678900' }
checkGs1Key('00', '106141411234567897')  // { ok: true, normalised: '106141411234567897' }
checkGs1Key('8003', '05012345678900CRATE9')  // { ok: true, normalised: '05012345678900CRATE9' }
checkGs1Key('253', '5012345678905X')
// { ok: false, normalised: null, message: '… should end in 0, not 5. …' }
```

### `gs1KeyPath(input)`

The canonical path for a key: leading slash, no trailing slash, qualifiers in
the standard's order rather than the caller's. Throws `Gs1KeyError` (with `.ai`)
when a value or a qualifier is wrong — a qualifier that does not belong to the
key is refused, never dropped, because dropping it would point two different
items at one address.

```ts
import { gs1KeyPath } from 'gs1-digital-link'

gs1KeyPath({
  ai: '01',
  value: '5012345678900',
  qualifiers: { '21': 'SER1', '10': 'LOT7', '22': 'V2' },
})
// '/01/05012345678900/22/V2/10/LOT7/21/SER1'
```

### `parseGs1KeyPath(pathname)` and `gs1PathFromUri(uri)`

`parseGs1KeyPath` reads a path back strictly: the segments must pair up, the
first pair must be a primary key, and each qualifier must be one that key allows
and must come after the ones before it. `gs1PathFromUri` does the same for a
whole URI somebody pasted, tolerating a path prefix, and returns the canonical
path.

```ts
import { gs1PathFromUri, parseGs1KeyPath } from 'gs1-digital-link'

parseGs1KeyPath('/01/05012345678900/10/LOT7/21/SER1')
// { ai: '01', value: '05012345678900', qualifiers: { '10': 'LOT7', '21': 'SER1' } }

parseGs1KeyPath('/01/05012345678900/21/SER1/10/LOT7')  // null — out of order

gs1PathFromUri('https://example.com/products/01/5012345678900/21/SER1')
// '/01/05012345678900/21/SER1'
```

### `describeGs1Path(path)`

```ts
import { describeGs1Path } from 'gs1-digital-link'

describeGs1Path('/01/05012345678900/10/LOT7')
// 'GTIN 05012345678900, Batch or lot LOT7'
```

### `parseElementString(raw)`

Splits a GS1-128 or GS1 DataMatrix payload into its AIs, or returns `null` when
the content is not an element string. A leading symbology identifier (`]C1`,
`]d2`, `]Q3`) is stripped, and a separator printed as `{GS}` is treated as the
real control character. An AI with no rule is read to the next separator and
reported by its number with no label, which keeps every field after it correct.

```ts
import { GROUP_SEPARATOR, parseElementString } from 'gs1-digital-link'

parseElementString(`010950600013435210LOT7${GROUP_SEPARATOR}21SER1`)
// [ { ai: '01', value: '09506000134352', label: 'GTIN' },
//   { ai: '10', value: 'LOT7', label: 'Batch or lot' },
//   { ai: '21', value: 'SER1', label: 'Serial number' } ]
```

### `readGs1(text)`

One entry point for whatever a scanner handed back: Digital Link or element
string, or `null` for content that is not GS1 at all.

```ts
import { readGs1 } from 'gs1-digital-link'

readGs1('https://example.com/01/09506000134352/10/LOT7?17=261231')
// { form: 'digital-link',
//   primary: { ai: '01', value: '09506000134352', label: 'GTIN' },
//   elements: [ { ai: '01', … }, { ai: '10', … }, { ai: '17', value: '261231', label: 'Expiry date' } ] }

readGs1('WIFI:S:Cafe;T:WPA;P:hunter2;;')  // null
```

### `aiLabel(ai)`

What an Application Identifier means, or `null`.

```ts
import { aiLabel } from 'gs1-digital-link'

aiLabel('17')   // 'Expiry date'
aiLabel('999')  // null
```

### Tables

`PRIMARY_KEYS`, `PRIMARY_KEY_AIS` and `QUALIFIERS` are exported, so an
application can build a form or a picker from the same rules the validators use.
`GS1_AIS` and `GS1_KEYS` describe the smaller set the URI encoder writes.

## Specification

Written against **GS1 Digital Link URI Syntax 1.7.0**, ratified August 2026,
together with the GS1 General Specifications for the AI formats, the
predefined-length table and the check digit calculation. Read at
[ref.gs1.org](https://ref.gs1.org/) in September 2026.

## Development

Node 22.18 or newer, because the tests run the TypeScript sources directly.

```
npm install
npm run typecheck
npm run build     # dist/esm and dist/cjs, with type declarations
npm test
```

---

Extracted from the GS1 tooling behind [QRSalt](https://qrsalt.com/barcode-generator). MIT licensed.
