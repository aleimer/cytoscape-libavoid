/**
 * The plugin's errors and console messages start with its name, so they can be
 * told apart in an app's console. Also the checks of option values, which throw
 * such errors.
 */

/** Put in front of every message of the plugin. */
const PREFIX = 'cytoscape-libavoid: ';

/**
 * Prefixes a message with the plugin's name, once.
 *
 * @param message the text, with or without the prefix
 * @returns `message` starting with the plugin's name
 */
export const pluginMessage = (message: string): string => (message.startsWith(PREFIX) ? message : PREFIX + message);

/**
 * An Error whose message starts with the plugin's name, see {@link pluginMessage}.
 *
 * @param message the text, with or without the prefix
 * @returns the error, not thrown
 */
export const pluginError = (message: string): Error => new Error(pluginMessage(message));

/**
 * Throws unless `value` is a finite number of at least 0.
 *
 * @param name  the option, for the message
 * @param value the value to check
 * @throws {Error} a {@link pluginError} naming the option and the value
 */
export function checkNonNegative(name: string, value: unknown): void
{
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  {
    throw pluginError(`option ${name} must be a number >= 0, got ${String(value)}`);
  }
}

/**
 * Throws unless `value` is one of `allowed`.
 *
 * @param name    the option, for the message
 * @param value   the value to check
 * @param allowed the values the option accepts
 * @throws {Error} a {@link pluginError} naming the option and the allowed values
 */
export function checkOneOf(name: string, value: unknown, allowed: readonly unknown[]): void
{
  if (!allowed.includes(value))
  {
    throw pluginError(`option ${name} must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}`);
  }
}
