/**
 * Response helpers for API routes
 */

/**
 * JSON response helper
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Error response helper
 */
export function error(message, status = 400) {
  return json({ error: message }, status);
}

/**
 * Success response helper
 */
export function success(message, data = {}) {
  return json({ success: true, message, ...data });
}

/**
 * CSV response helper
 */
export function csv(content, filename) {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
