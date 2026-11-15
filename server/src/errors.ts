/**
 * A refusal the user should see, in Portuguese. Thrown anywhere; HTTP routes answer it with its
 * status and `{ message, ...extra }`, socket events with `{ ok: false, error, ...extra }`.
 * Any other error is a bug or a server failure: logged, and answered with a generic message.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string | number> = {},
  ) {
    super(message);
  }
}
