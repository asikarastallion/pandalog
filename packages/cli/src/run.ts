/**
 * The CLI as a function.
 *
 * `runCli` takes its entire world as an argument — argv, a file reader, two output sinks, a clock —
 * and returns an exit code instead of calling `process.exit`. Everything that makes a CLI awkward
 * to test lives in `bin.ts`, which is a dozen lines of wiring; everything worth testing lives here
 * and is exercised without a process, a filesystem, or a wall clock.
 *
 * Two output rules, both there so the tool composes:
 *
 *   JSON goes to stdout and nothing else ever does, so `pandalog verify f.bin > result.json`
 *   produces a parseable document. Diagnostics and the human summary go to stderr.
 *
 *   Nothing is written to stdout until the pipeline has succeeded. A consumer never has to
 *   distinguish a complete document from half of one followed by an error.
 */
import { parseArgs, USAGE, type VerifyCommand } from './args.js';
import { EXIT, exitCodeFor, type ExitCode } from './exit-codes.js';
import { buildDocument, summarise } from './output.js';
import { runPipeline } from './pipeline.js';

/** The package version, asserted against `package.json` by a test so the two cannot drift. */
export const CLI_VERSION = '0.1.0';

export interface CliEnvironment {
  /** argv with the node binary and script path already removed. */
  readonly argv: readonly string[];
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly now: () => Date;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function verify(command: VerifyCommand, environment: CliEnvironment): Promise<ExitCode> {
  let bytes: Uint8Array;
  try {
    bytes = await environment.readFile(command.file);
  } catch (error) {
    environment.stderr(`pandalog: cannot read ${command.file}: ${describe(error)}\n`);
    return EXIT.INPUT;
  }

  let result;
  try {
    result = await runPipeline({ fileName: command.file, bytes, now: environment.now });
  } catch (error) {
    environment.stderr(`pandalog: cannot verify ${command.file}: ${describe(error)}\n`);
    return EXIT.INPUT;
  }

  const exitCode = exitCodeFor(result.verification.summary);
  const document = buildDocument({ version: CLI_VERSION, result, exitCode });

  environment.stdout(`${JSON.stringify(document, null, 2)}\n`);

  if (!command.quiet) {
    environment.stderr(
      `${command.file}: ${summarise(result.verification)}\n` +
        `Requirement set ${result.verification.requirementSetId} ` +
        `v${result.verification.requirementSetVersion} ` +
        `(source: ${result.verification.requirementSetSource}). ` +
        'Its criteria are provisional and do not trace to a flight-test document, so a PASS means ' +
        'a placeholder criterion was met.\n',
    );
  }

  return exitCode;
}

/**
 * Run one CLI invocation.
 *
 * @returns the process exit code. See `exit-codes.ts` for what each one promises.
 */
export async function runCli(environment: CliEnvironment): Promise<ExitCode> {
  const parsed = parseArgs(environment.argv);

  switch (parsed.kind) {
    case 'help':
      environment.stdout(USAGE);
      return EXIT.OK;

    case 'version':
      environment.stdout(`${CLI_VERSION}\n`);
      return EXIT.OK;

    case 'usage-error':
      environment.stderr(`pandalog: ${parsed.message}\n`);
      return EXIT.USAGE;

    case 'verify':
      try {
        return await verify(parsed, environment);
      } catch (error) {
        // Anything reaching here is a defect rather than bad input; say so plainly and use a
        // distinct code, so CI can tell "the tool broke" from "the aircraft failed".
        environment.stderr(`pandalog: internal error: ${describe(error)}\n`);
        return EXIT.INTERNAL;
      }
  }
}
