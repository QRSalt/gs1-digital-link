import { aiLabel, parseElementString, type Gs1Element } from './element-string.ts'
import { PRIMARY_KEYS, QUALIFIERS, parseGs1KeyPath } from './keys.ts'

/**
 * What a decoded symbol says in GS1 terms, when it says anything.
 *
 * Two shapes carry GS1 data and a scanner returns both as plain text:
 *
 *  - a **Digital Link** — a URL whose path is `/01/09506000134352/…`, which is
 *    what a 2D code on a retail pack will hold from 2027;
 *  - an **element string** — what a GS1-128 barcode or a GS1 DataMatrix on a
 *    carton has always carried.
 *
 * Both are pure computation over the text a decoder has already produced:
 * nothing is fetched and nothing is looked up.
 */

export interface Gs1Reading {
  /** Which of the two shapes it was. */
  form: 'digital-link' | 'element-string'
  /** Every application identifier found, in the order the content carries them. */
  elements: Gs1Element[]
  /** The identifying key, when the content has one: `{ ai: '01', value: … }`. */
  primary: { ai: string; value: string; label: string } | null
}

function readDigitalLink(text: string): Gs1Reading | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const segments = url.pathname.split('/').filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    if (!PRIMARY_KEYS[segments[i]!]) continue
    const parsed = parseGs1KeyPath(segments.slice(i).join('/'))
    if (!parsed) continue

    const primary = PRIMARY_KEYS[parsed.ai]!
    const elements: Gs1Element[] = [
      { ai: parsed.ai, value: parsed.value, label: primary.label },
    ]
    for (const [ai, value] of Object.entries(parsed.qualifiers)) {
      elements.push({ ai, value, label: QUALIFIERS[ai]?.label ?? aiLabel(ai) })
    }
    // Data attributes ride in the query string: an expiry date, a weight, a
    // price. Only the numeric keys are GS1's; `utm_source` and friends are not.
    //
    // Named from the element-string table, not the qualifier table: a
    // qualifier is a thing that may appear in the *path*, and 17 and 11 — the
    // two commonest attributes — are not in it. Looking them up there returns
    // an unlabelled `17` for an expiry date.
    for (const [key, value] of url.searchParams) {
      if (/^\d{2,4}$/.test(key) && value) {
        elements.push({ ai: key, value, label: QUALIFIERS[key]?.label ?? aiLabel(key) })
      }
    }
    return {
      form: 'digital-link',
      elements,
      primary: { ai: parsed.ai, value: parsed.value, label: primary.label },
    }
  }
  return null
}

/**
 * Read GS1 content out of decoded text, or null when there is none.
 *
 * Digital Link first, because a URL can also start with two digits and would
 * otherwise be mistaken for an element string.
 */
export function readGs1(text: string): Gs1Reading | null {
  const link = readDigitalLink(text)
  if (link) return link

  const elements = parseElementString(text)
  if (!elements) return null

  const head = elements[0]!
  const primary = PRIMARY_KEYS[head.ai]
  return {
    form: 'element-string',
    elements,
    primary: primary ? { ai: head.ai, value: head.value, label: primary.label } : null,
  }
}
