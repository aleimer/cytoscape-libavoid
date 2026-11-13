/**
 * The plugin's errors and console messages start with its name, so they can be
 * told apart in an app's console. Also the checks that throw such errors: of
 * option values, and of values the code relies on being there.
 */

/** Put in front of every message of the plugin. */
const PREFIX: string = "cytoscape-libavoid: ";

/**
 * Prefixes a message with the plugin's name, once.
 *
 * @param message the text, with or without the prefix
 * @returns `message` starting with the plugin's name
 */
export const pluginMessage: (message: string) => string = (
    message: string,
): string => (message.startsWith(PREFIX) ? message : PREFIX + message);

/**
 * An Error whose message starts with the plugin's name, see {@link pluginMessage}.
 *
 * @param message the text, with or without the prefix
 * @returns the error, not thrown
 */
export const pluginError: (message: string) => Error = (message: string): Error => new Error(pluginMessage(message));

/**
 * Throws unless `value` is a finite number of at least 0.
 *
 * @param name  the option, for the message
 * @param value the value to check
 * @throws {Error} a {@link pluginError} naming the option and the value
 */
export function checkNonNegative(name: string, value: unknown): void
{
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
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
        throw pluginError(`option ${name} must be one of ${allowed.map((v: unknown) => JSON.stringify(v)).join(", ")}`);
    }
}

/**
 * A list item the code relies on being there, instead of `items[index]!`: with
 * `noUncheckedIndexedAccess` an index lookup may be undefined, and an index out of
 * range would otherwise only surface later as an obscure `undefined`.
 *
 * @param items the list
 * @param index a position that must exist in it
 * @returns `items[index]`
 * @throws {Error} a {@link pluginError} if there is no item at `index`
 */
export function itemAt<T>(items: readonly T[], index: number): T
{
    const item: T | undefined = items[index];
    if (item === undefined)
    {
        throw pluginError(`internal error: no item ${index} of ${items.length}`);
    }
    return item;
}

/**
 * A value the code relies on being there, instead of `value!`, e.g. a map entry
 * whose key was checked before.
 *
 * @param value the value
 * @param what  what it is, for the message
 * @returns `value`
 * @throws {Error} a {@link pluginError} if `value` is undefined
 */
export function defined<T>(value: T | undefined, what: string): T
{
    if (value === undefined)
    {
        throw pluginError(`internal error: ${what} is missing`);
    }
    return value;
}
