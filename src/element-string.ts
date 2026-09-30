/**
 * Reading a GS1 element string — what a GS1-128 or a GS1 DataMatrix actually
 * carries.
 *
 * A scanner hands back one run of characters: `0109506000134352102024AB` and so
 * on, with an invisible group separator wherever a variable-length field ends.
 * Splitting that into "GTIN 09506000134352, batch 2024AB" needs one table and
 * no state at all.
 *
 * Two things make the split possible at all:
 *
 *  - some AIs have a length fixed by the specification, and those carry no
 *    separator after them;
 *  - every other AI runs to the next group separator, or to the end.
 *
 * An AI we do not know is read to the next separator and reported by its
 * number with no label. That is the honest answer: the split is still right,
 * and inventing a length for an AI we have not got a rule for would corrupt
 * every field after it.
 *
 * Reference: GS1 General Specifications, "Application Identifiers" and the
 * table of AIs with a predefined length.
 */

/** ASCII 29. What FNC1 becomes when a scanner emits the data as text. */
export const GROUP_SEPARATOR = '\x1d'

/**
 * Total length, AI included, of every AI whose length the specification fixes.
 *
 * Keyed by the first two digits, which is how the table is written: `3103` is a
 * `31` and therefore ten characters, four of AI and six of value.
 */
const PREDEFINED_LENGTH: Record<string, number> = {
  '00': 20,
  '01': 16,
  '02': 16,
  '03': 16,
  '04': 18,
  '11': 8,
  '12': 8,
  '13': 8,
  '14': 8,
  '15': 8,
  '16': 8,
  '17': 8,
  '18': 8,
  '19': 8,
  '20': 4,
  '31': 10,
  '32': 10,
  '33': 10,
  '34': 10,
  '35': 10,
  '36': 10,
  '41': 16,
}

/**
 * The AIs we can name, and how many digits each one's number is.
 *
 * The length of the *number* is what the split needs: `3103` is one AI and not
 * `31` followed by `03`. The label is what makes the answer readable.
 */
const KNOWN: Record<string, string> = {
  '00': 'SSCC',
  '01': 'GTIN',
  '02': 'GTIN of contained trade items',
  '10': 'Batch or lot',
  '11': 'Production date',
  '12': 'Due date',
  '13': 'Packaging date',
  '15': 'Best before date',
  '16': 'Sell by date',
  '17': 'Expiry date',
  '20': 'Variant',
  '21': 'Serial number',
  '22': 'Consumer product variant',
  '30': 'Count of items',
  '37': 'Count of trade items',
  '235': 'Third party GTIN extension',
  '240': 'Additional product identification',
  '241': 'Customer part number',
  '242': 'Made-to-order variation',
  '243': 'Packaging component number',
  '250': 'Secondary serial number',
  '251': 'Reference to source entity',
  '253': 'GDTI',
  '254': 'GLN extension',
  '255': 'GCN',
  '400': 'Customer purchase order number',
  '401': 'GINC',
  '402': 'GSIN',
  '403': 'Routing code',
  '410': 'Ship to GLN',
  '411': 'Bill to GLN',
  '412': 'Purchased from GLN',
  '413': 'Ship for GLN',
  '414': 'GLN of a physical location',
  '415': 'GLN of the invoicing party',
  '416': 'GLN of the production party',
  '417': 'Party GLN',
  '3100': 'Net weight, kg',
  '3101': 'Net weight, kg',
  '3102': 'Net weight, kg',
  '3103': 'Net weight, kg',
  '3200': 'Net weight, lb',
  '3920': 'Amount payable',
  '3921': 'Amount payable',
  '3922': 'Amount payable',
  '3923': 'Amount payable',
  '7003': 'Expiry date and time',
  '7007': 'Harvest date',
  '8003': 'GRAI',
  '8004': 'GIAI',
  '8006': 'ITIP',
  '8010': 'CPID',
  '8011': 'CPID serial',
  '8013': 'GMN',
  '8017': 'GSRN (provider)',
  '8018': 'GSRN (recipient)',
  '8019': 'Service relation instance',
  '8020': 'Payment slip reference',
  '8200': 'Product URL',
}

export interface Gs1Element {
  ai: string
  value: string
  /** What the AI means, or null for one we have no name for. */
  label: string | null
}

/**
 * What an application identifier means, or null.
 *
 * The same table names an AI whichever shape it arrived in. A Digital Link
 * carries its data attributes in the query string — `?17=271231` — and those
 * are the same AIs a GS1-128 carries after a separator, so they are read out
 * of one table rather than two that drift apart.
 */
export function aiLabel(ai: string): string | null {
  return KNOWN[ai] ?? null
}

/**
 * How long the AI at the head of `rest` is: two, three or four digits.
 *
 * Longest first, because `8011` and `80` would both match a two-digit test and
 * only one of them is an AI. An AI we cannot name at all is read as two
 * digits — the commonest width — and then run to the separator, which keeps
 * the rest of the string readable instead of losing it.
 */
function aiLength(rest: string): number {
  for (const width of [4, 3, 2]) {
    if (rest.length >= width && KNOWN[rest.slice(0, width)] !== undefined) return width
  }
  return 2
}

/**
 * Split an element string into its application identifiers.
 *
 * Returns null when the content is not one: it starts with something that is
 * not digits, or a field runs off the end. Null rather than a partial list,
 * because "we read three of the five fields" is not something a caller can
 * safely act on.
 */
export function parseElementString(raw: string): Gs1Element[] | null {
  // A scanner may hand back the symbology identifier in front of the data
  // (`]C1` for GS1-128, `]d2` for GS1 DataMatrix, `]Q3` for a GS1 QR). It is
  // not part of the content.
  let rest = raw.replace(/^\][A-Za-z]\d/, '')
  // Some readers print FNC1 as `{GS}` or a caret rather than the control
  // character. All three mean the same break.
  rest = rest.replace(/\{GS\}/g, GROUP_SEPARATOR)
  if (!rest || !/^\d{2}/.test(rest)) return null

  const elements: Gs1Element[] = []
  while (rest.length > 0) {
    // A separator before an AI is an empty field, which is not a thing.
    if (rest.startsWith(GROUP_SEPARATOR)) {
      rest = rest.slice(1)
      continue
    }
    const width = aiLength(rest)
    const ai = rest.slice(0, width)
    if (!/^\d+$/.test(ai) || ai.length < width) return null
    rest = rest.slice(width)

    const fixed = PREDEFINED_LENGTH[ai.slice(0, 2)]
    let value: string
    if (fixed !== undefined) {
      // The table's total covers the AI, whatever its width.
      value = rest.slice(0, fixed - width)
      if (value.length < fixed - width) return null
      rest = rest.slice(fixed - width)
      // A predefined-length field carries no separator, but a scanner that
      // emitted one anyway should not cost us the next field.
      if (rest.startsWith(GROUP_SEPARATOR)) rest = rest.slice(1)
    } else {
      const cut = rest.indexOf(GROUP_SEPARATOR)
      value = cut === -1 ? rest : rest.slice(0, cut)
      rest = cut === -1 ? '' : rest.slice(cut + 1)
    }

    if (value === '') return null
    elements.push({ ai, value, label: KNOWN[ai] ?? null })
  }

  return elements.length > 0 ? elements : null
}
