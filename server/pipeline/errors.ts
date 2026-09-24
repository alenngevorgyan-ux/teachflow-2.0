/** A request that cannot be served as sent (missing / invalid input). Mapped to HTTP 400. */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInputError';
  }
}
