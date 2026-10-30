/**
 * The plugin's errors and console messages start with its name, so they can be
 * told apart in an app's console. Also the checks of option values, which throw
 * such errors.
 */

const PREFIX = 'cytoscape-libavoid: ';

/** `message` with the plugin's name in front, once. */
export const pluginMessage = (message: string): string => (message.startsWith(PREFIX) ? message : PREFIX + message);

/** An Error with pluginMessage(). */
export const pluginError = (message: string): Error => new Error(pluginMessage(message));

/** Throws unless `value` is a finite number of at least 0; `name` is the option, for the message. */
export function checkNonNegative(name: string, value: unknown): void
{
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  {
    throw pluginError(`option ${name} must be a number >= 0, got ${String(value)}`);
  }
}

/** Throws unless `value` is one of `allowed`; `name` is the option, for the message. */
export function checkOneOf(name: string, value: unknown, allowed: readonly unknown[]): void
{
  if (!allowed.includes(value))
  {
    throw pluginError(`option ${name} must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}`);
  }
}
