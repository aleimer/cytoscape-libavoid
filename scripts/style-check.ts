/**
 * Code style rules for src/ that oxlint and dprint do not cover:
 *   node scripts/style-check.ts         lists the violations, exits with 1 if there are any
 *   node scripts/style-check.ts --fix   also turns multi-line `//` comments into JSDoc
 *
 * - every interface has a JSDoc comment
 * - comments of more than one line are JSDoc comments, not several `//` lines
 * - file-level constants holding values are UPPER_CASE (functions and classes
 *   assigned to a constant keep their names)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';

const ROOT = 'src';
const CONSTANT_NAME = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const FIX = process.argv.includes('--fix');

/** A node of oxc-parser's ESTree AST, as far as this script reads it. */
interface AstNode
{
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** A comment as oxc-parser returns it: `value` without the `//` or `/*`. */
interface AstComment
{
  type: 'Line' | 'Block';
  value: string;
  start: number;
  end: number;
}

/** All .ts files below a folder. */
async function filesIn(folder: string): Promise<string[]>
{
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
    {
      const path = join(folder, entry.name);
      if (entry.isDirectory())
      {
        return filesIn(path);
      }
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

/** The 1-based line of an offset. */
const lineOf = (source: string, offset: number): number => source.slice(0, offset).split('\n').length;

/** Runs of standalone `//` comment lines with at least two lines: [first line index, last line index]. */
function lineCommentRuns(lines: readonly string[]): Array<[number, number]>
{
  const runs: Array<[number, number]> = [];
  const isComment = (line: string | undefined): boolean => line !== undefined && /^\s*\/\/(?!\/)/.test(line);
  for (let i = 0; i < lines.length; i++)
  {
    if (!isComment(lines[i]))
    {
      continue;
    }
    let last = i;
    while (isComment(lines[last + 1]))
    {
      last++;
    }
    if (last > i)
    {
      runs.push([i, last]);
    }
    i = last;
  }
  return runs;
}

/** The lines of a `//` comment run as one JSDoc comment, at the same indentation. */
function asJsDoc(lines: readonly string[]): string[]
{
  const indent = /^\s*/.exec(lines[0]!)![0];
  const texts = lines.map((line) => line.trim().replace(/^\/\/ ?/, ''));
  return [`${indent}/**`, ...texts.map((text) => (text ? `${indent} * ${text}` : `${indent} *`)), `${indent} */`];
}

/** True if a JSDoc comment ends right before `offset`, with only whitespace in between. */
function hasJsDoc(source: string, comments: readonly AstComment[], offset: number): boolean
{
  return comments.some(
    (comment) =>
      comment.type === 'Block' && comment.value.startsWith('*') && source.slice(comment.end, offset).trim() === '',
  );
}

/** True if a constant's value is a function or class, which keeps its camelCase / PascalCase name. */
function holdsFunction(declarator: AstNode): boolean
{
  let init = declarator['init'] as AstNode | null;
  while (init && (init.type === 'TSAsExpression' || init.type === 'TSSatisfiesExpression'))
  {
    init = init['expression'] as AstNode;
  }
  const isFunction = (node: AstNode | null): boolean =>
    !!node && ['ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression'].includes(node.type);
  if (isFunction(init))
  {
    return true;
  }
  return init?.type === 'ConditionalExpression' &&
    isFunction(init['consequent'] as AstNode) &&
    isFunction(init['alternate'] as AstNode);
}

/** The names a declarator declares: one identifier or those of a destructuring pattern. */
function declaredNames(pattern: AstNode): string[]
{
  if (pattern.type === 'Identifier')
  {
    return [pattern['name'] as string];
  }
  if (pattern.type === 'ObjectPattern')
  {
    return (pattern['properties'] as AstNode[]).flatMap((property) =>
      declaredNames((property['value'] ?? property['argument']) as AstNode)
    );
  }
  if (pattern.type === 'ArrayPattern')
  {
    return (pattern['elements'] as Array<AstNode | null>).flatMap((element) => (element ? declaredNames(element) : []));
  }
  return [];
}

/** The violations in one file; with --fix, rewrites its `//` comment runs first. */
async function check(path: string): Promise<string[]>
{
  let source = await readFile(path, 'utf8');
  const problems: string[] = [];

  const lines = source.split('\n');
  const runs = lineCommentRuns(lines);
  if (FIX && runs.length > 0)
  {
    for (const [first, last] of [...runs].reverse())
    {
      lines.splice(first, last - first + 1, ...asJsDoc(lines.slice(first, last + 1)));
    }
    source = lines.join('\n');
    await writeFile(path, source);
  }
  else
  {
    for (const [first] of runs)
    {
      problems.push(`${path}:${first + 1}: comment of several lines: use /** … */`);
    }
  }

  const { program, comments, errors } = parseSync(path, source);
  if (errors.length > 0)
  {
    return [`${path}: does not parse: ${errors[0]!.message}`];
  }
  for (const statement of program.body as unknown as AstNode[])
  {
    const declaration = statement.type === 'ExportNamedDeclaration' && statement['declaration'] ?
      (statement['declaration'] as AstNode) :
      statement;
    if (declaration.type === 'TSInterfaceDeclaration' && !hasJsDoc(source, comments, statement.start))
    {
      const name = (declaration['id'] as AstNode)['name'] as string;
      problems.push(`${path}:${lineOf(source, statement.start)}: interface ${name} has no JSDoc comment`);
    }
    if (declaration.type === 'VariableDeclaration' && declaration['kind'] === 'const')
    {
      for (const declarator of declaration['declarations'] as AstNode[])
      {
        if (holdsFunction(declarator))
        {
          continue;
        }
        for (const name of declaredNames(declarator['id'] as AstNode))
        {
          if (!CONSTANT_NAME.test(name))
          {
            problems.push(`${path}:${lineOf(source, declarator.start)}: constant ${name} is not UPPER_CASE`);
          }
        }
      }
    }
  }
  return problems;
}

const problems = (await Promise.all((await filesIn(ROOT)).map(check))).flat();
for (const problem of problems)
{
  console.log(problem);
}
if (problems.length > 0)
{
  console.log(`\n${problems.length} style problem(s)`);
  process.exitCode = 1;
}
