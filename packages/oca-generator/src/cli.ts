#!/usr/bin/env node
/**
 * `oca`: builds and checks the bundle of an OCA Generator project file (`*.credential-project.json`) from the command
 * line, for scripts and CI. It imports the package by its own name, so it only reaches the public API, and it
 * makes no network request. `oca --help` describes the commands; the exit codes are in `EXIT`.
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  type Group,
  type Issue,
  PROJECT_FILE_VERSION,
  type Project,
  exportProject,
  parseProjectFile,
  validate,
} from '@bryanrmq/oca-generator';

/** 0: no errors (warnings are printed). 1: validation errors. 2: input that can't be used, or bad arguments. */
const EXIT = { ok: 0, errors: 1, input: 2 } as const;

const USAGE = `Usage:
  oca build <project.credential-project.json> [-o bundle.json] [--vct vct.json]
  oca check <project.credential-project.json>
`;

const HELP = `oca: build and check swiyu OCA bundles from OCA Generator project files.

${USAGE}
Commands:
  build   Validate the project and write its bundle (to stdout without -o), then
          print its uri#integrity and its Type Metadata (vct.json). Writes
          nothing when there are errors.
  check   List the project's errors and warnings, as the app's Issues panel does.

Options:
  -o, --output <file>  Write the bundle to <file> instead of stdout.
      --vct <file>     Write the Type Metadata to <file> instead of printing it.
  -h, --help           Show this help.
      --version        Show the version.

Exit codes:
  0  No errors (warnings are printed).
  1  Validation errors.
  2  Input that can't be used: a file that can't be read or written, not a
     project file, a file saved by a newer app, or bad arguments.
`;

const VCT_HINT = 'Type Metadata (vct.json) for the swiyu generic issuer, which fills in ${external-url} when it serves the file:';
/** The app's wording: the Issues panel's texts. */
const NO_ISSUES = 'No issues. The bundle is ready.';
const LOCATIONS = { credential: 'Credential', languages: 'Languages', hosting: 'Hosting' };
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A problem with the input or the arguments: exit code 2 with `message`. */
class InputError extends Error {}

type Style = (text: string) => string;

/** ANSI styles for `stream`, or none when it is not a terminal (or NO_COLOR is set). */
function styles(stream: NodeJS.WriteStream): Record<'bold' | 'dim' | 'red' | 'yellow' | 'green', Style> {
  const on = stream.isTTY === true && typeof stream.hasColors === 'function' && stream.hasColors();
  const wrap = (open: number, close: number): Style => (text) => (on ? `\x1b[${open}m${text}\x1b[${close}m` : text);
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39) };
}

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

async function readProject(file: string): Promise<Project> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new InputError(`Can't read ${file}: ${(error as Error).message}`);
  }
  const parsed = parseProjectFile(text);
  if (parsed.ok) return parsed.project;
  if (parsed.error === 'newer') {
    throw new InputError(`${file} was saved by a newer OCA Generator; this oca opens project files up to version ${PROJECT_FILE_VERSION}. Update oca.`);
  }
  throw new InputError(`${file} is not an OCA Generator project file (*.credential-project.json). Save one from the app: menu → Save project file.`);
}

async function write(file: string, text: string): Promise<void> {
  try {
    await writeFile(file, text);
  } catch (error) {
    throw new InputError(`Can't write ${file}: ${(error as Error).message}`);
  }
}

/** The keys from the root down to a node, or null when the node is not in `group`. */
function keyPath(group: Group, nodeId: string): string[] | null {
  for (const node of group.children) {
    if (node.id === nodeId) return [node.key];
    const below = node.kind === 'group' ? keyPath(node.group, nodeId) : null;
    if (below) return [node.key, ...below];
  }
  return null;
}

/** Where an issue sits, as the Issues panel shows it: the attribute's key path, or what else it is about. */
function location(issue: Issue, project: Project): string {
  const target = issue.target;
  if (target.kind !== 'node') return LOCATIONS[target.kind];
  return keyPath(project.root, target.nodeId)?.join('.') ?? '';
}

interface IssueEntry {
  location: string;
  /** Languages the issue occurs in; empty when it is not language-specific. */
  langs: string[];
  text: string;
}

/** One entry per issue and field, merging the copies raised for each language, as the Issues panel lists them. */
function groupIssues(issues: Issue[], project: Project): { errors: IssueEntry[]; warnings: IssueEntry[] } {
  const groups = { error: new Map<string, IssueEntry>(), warning: new Map<string, IssueEntry>() };
  for (const issue of issues) {
    const { lang, ...field } = issue.target as Issue['target'] & { lang?: string };
    const key = [issue.code, JSON.stringify(field), issue.summary].join('|');
    let entry = groups[issue.severity].get(key);
    if (!entry) {
      entry = { location: location(issue, project), langs: [], text: issue.message };
      groups[issue.severity].set(key, entry);
    }
    if (lang && !entry.langs.includes(lang)) {
      entry.langs.push(lang);
      entry.text = issue.summary; // the languages are listed, so drop them from the text
    }
  }
  return { errors: [...groups.error.values()], warnings: [...groups.warning.values()] };
}

/** The issues grouped by severity, errors first, each with its location and languages; empty without issues. */
function formatIssues(issues: Issue[], project: Project, style: ReturnType<typeof styles>): string {
  const { errors, warnings } = groupIssues(issues, project);
  const section = (title: string, entries: IssueEntry[], tone: Style) => {
    if (entries.length === 0) return '';
    const lines = entries.map(({ location, langs, text }) => {
      const where = [location, langs.length > 0 ? `(${langs.join(', ')})` : ''].filter(Boolean).join(' ');
      return `  ${tone('●')} ${where ? `${style.bold(where)}: ` : ''}${text}`;
    });
    return `${tone(style.bold(`${title} (${entries.length})`))}\n${lines.join('\n')}\n\n`;
  };
  const totals = [errors.length > 0 && count(errors.length, 'error'), warnings.length > 0 && count(warnings.length, 'warning')].filter(Boolean);
  if (totals.length === 0) return '';
  return `${section('Errors', errors, style.red)}${section('Warnings', warnings, style.yellow)}${totals.join(', ')}.\n`;
}

async function check(file: string): Promise<number> {
  const project = await readProject(file);
  const issues = validate(project);
  const style = styles(process.stdout);
  process.stdout.write(formatIssues(issues, project, style) || `${style.green(NO_ISSUES)}\n`);
  return issues.some((issue) => issue.severity === 'error') ? EXIT.errors : EXIT.ok;
}

async function build(file: string, output: string | undefined, vctFile: string | undefined): Promise<number> {
  const project = await readProject(file);
  const result = await exportProject(project);
  const issues = formatIssues(result.issues, project, styles(process.stderr));
  if (issues) process.stderr.write(`${issues}\n`);
  if (!result.ok) {
    process.stderr.write('Nothing written: fix the errors first.\n');
    return EXIT.errors;
  }

  // The bundle is written byte for byte as the app downloads it, so its #integrity holds. When it goes to stdout,
  // the rest goes to stderr to keep stdout a clean bundle.
  const report = output ? process.stdout : process.stderr;
  const style = styles(report);
  if (output) await write(output, result.outputs.json);
  else process.stdout.write(result.outputs.json);
  // Byte for byte too: the Issuer Metadata's `vct_metadata_uri#integrity` hashes the text the generic issuer serves,
  // which is this file's with `${external-url}` filled in.
  if (vctFile) await write(vctFile, result.vct.text);

  const lines: string[] = [];
  if (output) lines.push(`Wrote ${output}`);
  if (vctFile) lines.push(`Wrote ${vctFile} (Type Metadata)`);
  const uri = project.hosting.mode === 'dataUrl' ? 'embedded as a data URL' : result.outputs.uri || '(no hosting URL)';
  lines.push(`${style.bold('uri')}            ${uri}`, `${style.bold('uri#integrity')}  ${result.outputs.integrity}`);
  if (!vctFile) lines.push('', style.dim(VCT_HINT), result.vct.text);
  report.write(`${output ? '' : '\n'}${lines.join('\n')}\n`);
  return EXIT.ok;
}

async function main(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(args);
  } catch (error) {
    process.stderr.write(`oca: ${(error as Error).message}\nRun oca --help for usage.\n`);
    return EXIT.input;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return EXIT.ok;
  }
  if (values.help) {
    process.stdout.write(HELP);
    return EXIT.ok;
  }
  const [command, file, ...extra] = positionals;
  const usage = (message: string) => {
    process.stderr.write(`oca: ${message}\n\n${USAGE}Run oca --help for more.\n`);
    return EXIT.input;
  };
  if (command === undefined) return usage('missing command.');
  if (command !== 'build' && command !== 'check') return usage(`unknown command "${command}".`);
  if (file === undefined) return usage(`missing project file: oca ${command} <project.credential-project.json>.`);
  if (extra.length > 0) return usage(`unexpected argument "${extra[0]}".`);
  if (command === 'check' && (values.output !== undefined || values.vct !== undefined)) {
    return usage(`${values.output !== undefined ? '--output' : '--vct'} only goes with oca build.`);
  }

  try {
    return command === 'build' ? await build(file, values.output, values.vct) : await check(file);
  } catch (error) {
    // Anything else comes from a project file with the right shape on top but broken inside.
    const message = error instanceof InputError ? error.message : `Can't use ${file}: ${(error as Error).message}`;
    process.stderr.write(`oca: ${message}\n`);
    return EXIT.input;
  }
}

function parseCommandLine(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      vct: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
}

process.exitCode = await main(process.argv.slice(2));
