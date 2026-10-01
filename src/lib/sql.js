/**
 * Small SQL helpers.
 */

const SAFE_LITERAL = /^[a-z_]+$/;

/**
 * Render a list of constants (statuses) as SQL string literals for an `IN (...)`
 * clause: `sqlList(['a', 'b'])` is `'a', 'b'`. Only used with the compile-time
 * constants of src/shared/membership.js, never with request data, and it refuses
 * anything but lower-case letters and underscores to keep it that way. Inlining
 * them keeps D1's 100 bound-parameter budget for the id lists.
 * @param {readonly string[]} values
 * @returns {string}
 */
export function sqlList(values) {
  for (const value of values) {
    if (typeof value !== 'string' || !SAFE_LITERAL.test(value)) {
      throw new TypeError(`sqlList: unsafe literal ${JSON.stringify(value)}`);
    }
  }
  return values.map((value) => `'${value}'`).join(', ');
}
