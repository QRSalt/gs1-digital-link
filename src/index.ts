/**
 * GS1 Digital Link: encode, parse and validate.
 *
 * Written against GS1 Digital Link URI Syntax 1.7.0 and the GS1 General
 * Specifications. Pure string and arithmetic work — no dependencies, no
 * network, no storage.
 */

export { gtinCheckDigit } from './check-digit.ts'

export {
  GS1_AIS,
  GS1_KEYS,
  Gs1Error,
  checkGtin,
  encodeGs1DigitalLink,
  parseGs1DigitalLink,
  toGs1Date,
  type Gs1AiSpec,
  type Gs1Input,
  type Gs1Key,
  type Gs1Parsed,
  type GtinCheck,
} from './digital-link.ts'

export {
  Gs1KeyError,
  PRIMARY_KEYS,
  PRIMARY_KEY_AIS,
  QUALIFIERS,
  checkGs1Key,
  describeGs1Path,
  gs1KeyPath,
  gs1PathFromUri,
  parseGs1KeyPath,
  type Gs1KeyInput,
  type Gs1ParsedPath,
  type Gs1PrimaryKey,
  type Gs1Qualifier,
  type KeyCheck,
  type KeyRule,
} from './keys.ts'

export {
  GROUP_SEPARATOR,
  aiLabel,
  parseElementString,
  type Gs1Element,
} from './element-string.ts'

export { readGs1, type Gs1Reading } from './read.ts'
