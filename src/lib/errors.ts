// Domain errors thrown by services. Route handlers / server actions translate them to
// HTTP status codes or form errors in one place; services never know about HTTP.
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super(`${what} not found`, "NOT_FOUND", 404);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this") {
    super(message, "FORBIDDEN", 403);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in") {
    super(message, "UNAUTHORIZED", 401);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(message, code, 409);
  }
}
/** The requested slot was taken (maps the Postgres exclusion violation 23P01). */
export class SlotUnavailableError extends ConflictError {
  constructor() {
    super("That time was just taken. Please pick another slot.", "SLOT_UNAVAILABLE");
  }
}
/** Free-plan limit reached (staff count or monthly bookings). */
export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, "PLAN_LIMIT", 402);
  }
}

/** A business-rule violation in otherwise well-formed input (maps to 400). */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION", 400);
  }
}
