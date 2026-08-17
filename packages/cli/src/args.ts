/**
 * Argument parsing, as a pure function over argv.
 *
 * No dependency on `process`, so the entire command surface is exercised by unit tests rather than
 * by spawning a shell. Hand-written rather than pulled from a dependency: the grammar is one
 * command and three flags, and doc 04's zero-runtime-dependency posture is worth more here than
 * the few lines saved.
 */

/**
 * What `verify` writes to stdout.
 *
 * `json` is the machine-readable pipeline document a CI step consumes; `markdown` is the
 * reproducible report a human archives (doc 04 §7). Both come from the same run, so a step that
 * produces one and a step that produces the other cannot disagree about the flight.
 */
export const OUTPUT_FORMATS = ['json', 'markdown'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const FORMAT_SET: ReadonlySet<string> = new Set<string>(OUTPUT_FORMATS);

export interface VerifyCommand {
  readonly kind: 'verify';
  readonly file: string;
  readonly quiet: boolean;
  readonly format: OutputFormat;
}

export type ParsedArgs =
  | VerifyCommand
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'usage-error'; readonly message: string };

const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h', 'help']);

const usageError = (message: string): ParsedArgs => ({ kind: 'usage-error', message });

/**
 * Parse `argv` (already stripped of the node binary and script path).
 *
 * A bare invocation is a usage error rather than a help screen: printing help and exiting 0 would
 * make a mistyped CI step look like a successful verification.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: string[] = [];
  const positional: string[] = [];

  for (const argument of argv) {
    (argument.startsWith('-') ? flags : positional).push(argument);
  }

  if (argv.some((argument) => HELP_FLAGS.has(argument))) {
    return { kind: 'help' };
  }
  if (flags.includes('--version')) {
    return { kind: 'version' };
  }

  // `--format=markdown` rather than `--format markdown`: a separated value would land in the
  // positional list and be mistaken for a second log file, which the check below would then
  // reject with a confusing message about verifying several logs at once.
  const formatFlag = flags.find((flag) => flag.startsWith('--format'));
  const format = formatFlag?.slice('--format='.length) ?? 'json';

  if (formatFlag !== undefined && !FORMAT_SET.has(format)) {
    return usageError(
      `Unknown output format ${JSON.stringify(formatFlag.replace('--format=', ''))}. ` +
        `Supported formats: ${OUTPUT_FORMATS.join(', ')}.`,
    );
  }

  const unknownFlag = flags.find((flag) => flag !== '--quiet' && !flag.startsWith('--format='));
  if (unknownFlag !== undefined) {
    return usageError(`Unknown option ${unknownFlag}. Run "pandalog --help" for usage.`);
  }

  const [command, file, ...extra] = positional;

  if (command === undefined) {
    return usageError('No command given. Run "pandalog --help" for usage.');
  }
  if (command !== 'verify') {
    return usageError(`Unknown command "${command}". The only command is "verify".`);
  }
  if (file === undefined) {
    return usageError('"pandalog verify" needs a log file to verify.');
  }
  if (extra.length > 0) {
    return usageError(
      `"pandalog verify" takes one log at a time; got ${String(extra.length + 1)} ` +
        `(${file}, ${extra.join(', ')}). Verifying several logs needs a decision about how their ` +
        'outcomes combine into one exit code, which is not settled yet.',
    );
  }

  return {
    kind: 'verify',
    file,
    quiet: flags.includes('--quiet'),
    format: format as OutputFormat,
  };
}

export const USAGE = `pandalog — flight data verification

Usage:
  pandalog verify <log.bin> [--quiet] [--format=json|markdown]
  pandalog --help
  pandalog --version

Ingests an ArduPilot DataFlash log, detects events, runs the analysis rules and
verifies the result against the built-in requirement set. The result is written
to stdout; a human summary goes to stderr, so redirecting stdout gives a clean
document.

Options:
  --quiet             Suppress the stderr summary. Output is still written.
  --format=json       The full pipeline result as JSON. The default.
  --format=markdown   A reproducible report, provenance-stamped. Two runs over
                      the same log and versions produce byte-identical output
                      apart from the generation timestamp.
  -h, --help          Show this help.
  --version           Print the version.

Exit codes:
  0   Every requirement that applied passed.
  1   At least one requirement FAILED.
  2   Nothing failed, but nothing was conclusively verified either — every
      requirement was INCONCLUSIVE or NOT_APPLICABLE. This is deliberately not
      a success: no evidence is not a pass.
  64  The command line could not be understood.
  65  The log could not be read or parsed.
  70  An unexpected internal failure.

The built-in requirement set is provisional: none of its criteria trace to a
flight-test document. A PASS means a placeholder criterion was met.
`;
