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
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import {
  buildReport,
  flightCharts,
  renderFindingsCsv,
  renderHtml,
  renderMarkdown,
  renderVerificationCsv,
} from '@pandalog/reporting';
import { modeSegments } from '@pandalog/events';

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

  // Every format is rendered from the same run and the same document, so the archived report, the
  // printable page, the spreadsheet and the machine-readable JSON cannot disagree about the flight
  // (doc 04 §7).
  environment.stdout(render(command.format, result, environment.now, exitCode));

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
/**
 * Chart size for the printable report, in user units.
 *
 * The SVG scales to the page; this fixes the coordinate space so the aspect ratio is the same on
 * every panel and in every run — a report whose charts changed shape between runs would not be
 * reproducible in the way doc 04 §7 requires.
 */
const REPORT_CHART_SIZE = Object.freeze({ width: 720, height: 110 });

/**
 * One run, rendered into whichever form was asked for.
 *
 * Every branch starts from the same `ReportDocument`, so the archived report, the printable page,
 * the spreadsheet and the machine-readable JSON cannot disagree about the flight (doc 04 §7). The
 * switch is exhaustive over `OutputFormat`; adding a format without handling it fails to compile.
 */
function render(
  format: VerifyCommand['format'],
  result: PipelineResult,
  now: () => Date,
  exitCode: ExitCode,
): string {
  const document = buildReport({ ...result, now });

  switch (format) {
    case 'markdown':
      return renderMarkdown(document);
    case 'csv':
      return renderFindingsCsv(document);
    case 'csv-verification':
      return renderVerificationCsv(document);
    case 'html':
      return renderHtml(document, {
        panels:
          document.timeSpan === null
            ? []
            : flightCharts(
                result.dataset,
                modeSegments(document.events, document.timeSpan),
                document.timeSpan,
                { size: REPORT_CHART_SIZE },
              ),
      });
    case 'json':
      return `${JSON.stringify(buildDocument({ version: CLI_VERSION, result, exitCode }), null, 2)}\n`;
  }
}

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
