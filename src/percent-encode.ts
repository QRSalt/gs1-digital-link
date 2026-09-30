/**
 * Percent-encode one AI value for a path segment.
 *
 * `encodeURIComponent` is right except that it leaves `!'()*` alone, and the
 * URI Syntax standard requires those escaped inside an AI value. Everything
 * else on its list — `# / % & + , : ; < = > ?` — is already escaped.
 */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
