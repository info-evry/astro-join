/**
 * Request parsing helpers shared by the API handlers.
 */

/**
 * Parse the request body as a JSON object.
 * Resolves to `null` for an empty body, malformed JSON, or JSON that is not
 * a plain object (null, arrays, strings, numbers), so callers can answer
 * with a 400 instead of letting a TypeError surface as a 500.
 * @param {Request} request
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readJsonObject(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * True if a database error is a UNIQUE constraint violation.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUniqueConstraintError(err) {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
