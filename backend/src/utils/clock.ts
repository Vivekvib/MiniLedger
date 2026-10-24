/**
 * The single source of "now". Services never call `new Date()` directly, so tests can
 * inject a controllable clock and exercise expiry and date-boundary behaviour.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
