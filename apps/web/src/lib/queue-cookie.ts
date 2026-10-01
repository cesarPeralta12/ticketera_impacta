/** Cookie httpOnly con el token de la fila virtual de una función. Lo genera el servidor. */
export const queueCookieName = (sessionId: string) => `cola_${sessionId}`;

export const QUEUE_COOKIE_MAX_AGE = 2 * 60 * 60; // segundos
