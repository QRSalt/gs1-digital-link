/**
 * The GS1 modulo-10 check digit.
 *
 * Reference: GS1 General Specifications, "Check digit calculation".
 */

/**
 * The check digit for a GS1 key's body — the number without its final digit.
 *
 * Weights alternate 3 and 1 from the right, excluding the check digit itself,
 * which is the rule for every fixed-length numeric GS1 key: GTIN-8, -12, -13
 * and -14, SSCC, GLN, GSIN, GSRN and the thirteen-digit head of a GDTI, GCN or
 * GRAI. Counting from the right means the caller never has to know whether the
 * key's length is odd or even.
 *
 * It is *not* the rule for ISBN-10 (modulo 11) or for the GMN's check character
 * pair (modulo 1021), and it returns a plausible wrong answer for both.
 */
export function gtinCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0
  for (
    let i = digitsWithoutCheck.length - 1, weight = 3;
    i >= 0;
    i--, weight = weight === 3 ? 1 : 3
  ) {
    sum += Number(digitsWithoutCheck[i]) * weight
  }
  return (10 - (sum % 10)) % 10
}
