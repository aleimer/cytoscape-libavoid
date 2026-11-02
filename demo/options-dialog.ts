// The demo's "Plugin-Optionen" popup: how libavoid was loaded, the
// cy.libavoid() call of main.ts and the options in use, those that differ from
// DEFAULTS highlighted. Values go into the page as text, never as HTML.
import { DEFAULTS } from '../src';
import type { LibavoidOptions, LibavoidRouting } from '../src';

/** What the popup shows besides the options in use. */
export interface OptionsDialogSource
{
  /** The options main.ts passed to cy.libavoid(). */
  passed: Partial<LibavoidOptions>;
  /** Source code for values that cannot be shown as JSON, e.g. the worker. */
  sourceOf: Partial<Record<keyof LibavoidOptions, string>>;
  /** Where libavoid runs and whether it is ready, e.g. "Web Worker · bereit". */
  loadState: () => string;
}

/** A value as it would be written in code: functions with their source, the rest as JSON. */
function formatValue(value: unknown): string
{
  if (typeof value === 'function')
  {
    return value.toString();
  }
  if (typeof Worker !== 'undefined' && value instanceof Worker)
  {
    return 'Worker';
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** The cy.libavoid() call with these options, one per line. */
function callSource({ passed, sourceOf }: OptionsDialogSource): string
{
  const lines = Object.entries(passed).map(([name, value]) =>
    `  ${name}: ${sourceOf[name as keyof LibavoidOptions] ?? formatValue(value)},`
  );
  return `const routing = cy.libavoid({\n${lines.join('\n')}\n});`;
}

/** A table row: option, value in use, default; `changed` highlights it. */
function row(cells: string[], changed: boolean): HTMLTableRowElement
{
  const tr = document.createElement('tr');
  tr.className = changed ? 'changed' : '';
  for (const text of cells)
  {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  return tr;
}

/** Fills the popup with the current state and opens it. */
export function openOptionsDialog(routing: LibavoidRouting, source: OptionsDialogSource): void
{
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  $('optionsLoad').textContent = source.loadState();
  $('optionsCall').textContent = callSource(source);

  const options = routing.options;
  const defaults: Partial<Record<string, unknown>> = DEFAULTS;
  const names = [...new Set([...Object.keys(DEFAULTS), ...Object.keys(options)])];
  $('optionsRows').replaceChildren(
    ...names.map((name) =>
    {
      const value = formatValue(options[name as keyof LibavoidOptions]);
      const fallback = formatValue(defaults[name]);
      return row([name, value, fallback], value !== fallback);
    }),
  );
  $<HTMLDialogElement>('optionsDialog').showModal();
}
