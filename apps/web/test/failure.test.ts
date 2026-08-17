/**
 * What a browser user sees when a file will not open.
 *
 * The deterministic packages already refuse malformed input properly — an `IngestionError` with a
 * code and an accurate message, never a partial dataset. This is about the other half: whether the
 * person who dropped the file learns anything actionable, or reads an accurate sentence written for
 * whoever wrote the parser.
 *
 * The split matters. The **code** is the domain's contract and this layer must not second-guess it.
 * The **wording** is presentation, which is the UI's job (doc 04 §1 rule 1) — so the mapping is
 * keyed on the code and adds guidance without restating, contradicting or hiding what the domain
 * said.
 */
import { describe, expect, it } from 'vitest';

import { describeFailure, MAX_LOG_BYTES, tooLargeMessage } from '../src/workspace/failure.js';

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('describeFailure', () => {
  it('keeps the domain message and adds a next step', () => {
    const described = describeFailure(
      failure('NO_ADAPTER', 'No registered parser adapter claims "photo.png".'),
    );

    expect(described.message).toContain('No registered parser adapter claims "photo.png".');
    expect(described.guidance).not.toBe('');
    expect(described.guidance).not.toBe(described.message);
  });

  it('tells a user who dropped the wrong kind of file what this reads', () => {
    const described = describeFailure(
      failure('NO_ADAPTER', 'No registered parser adapter claims.'),
    );

    expect(described.guidance).toMatch(/\.BIN/i);
  });

  it('explains an empty file without implying the log was bad', () => {
    const described = describeFailure(failure('EMPTY_SOURCE', 'Source file is empty.'));

    expect(described.guidance).toMatch(/empty|0 bytes|no bytes/i);
  });

  it('says a truncated or damaged log is not partially salvaged', () => {
    // Doc 04: a malformed log raises rather than being partly recovered. A user needs to know the
    // tool did not quietly analyse the readable half.
    const described = describeFailure(
      failure('ADAPTER_FAILED', '@pandalog/parser-ardupilot failed to decode "trunc.bin".'),
    );

    expect(described.guidance).toMatch(/truncated|incomplete|damaged/i);
    expect(described.guidance).toMatch(/nothing|no part|not analysed|never/i);
  });

  it('still says something useful for a code it has never seen', () => {
    // The mapping must not be the only thing standing between a user and a blank message, because
    // a new error code in a domain package would silently produce one.
    const described = describeFailure(
      failure('SOME_FUTURE_CODE', 'Something specific went wrong.'),
    );

    expect(described.message).toContain('Something specific went wrong.');
    expect(described.guidance.length).toBeGreaterThan(0);
  });

  it('handles an error carrying no code at all', () => {
    const described = describeFailure(new Error('Cannot read properties of undefined'));

    expect(described.message).toContain('Cannot read properties of undefined');
    expect(described.guidance.length).toBeGreaterThan(0);
  });

  it('handles something thrown that is not an Error', () => {
    const described = describeFailure('a bare string');

    expect(described.message).toContain('a bare string');
    expect(described.guidance.length).toBeGreaterThan(0);
  });

  it('never returns an empty message, whatever it was handed', () => {
    for (const thrown of [new Error(''), null, undefined, 0, {}]) {
      const described = describeFailure(thrown);

      expect(described.message.trim().length, JSON.stringify(thrown)).toBeGreaterThan(0);
      expect(described.guidance.trim().length, JSON.stringify(thrown)).toBeGreaterThan(0);
    }
  });
});

describe('the size guard', () => {
  it('states a limit in bytes that is large enough for a real flight', () => {
    // ArduPilot logs from a long sortie run to tens of megabytes; the guard exists to stop a tab
    // being killed by a video file, not to reject genuine logs.
    expect(MAX_LOG_BYTES).toBeGreaterThan(100 * 1024 * 1024);
  });

  it('names the file, its size and the limit, in units a person reads', () => {
    const message = tooLargeMessage('flight.bin', 3_221_225_472);

    expect(message).toContain('flight.bin');
    expect(message).toMatch(/3(\.0)? GB|3072 MB/);
    expect(message).toMatch(/MB|GB/);
  });

  it('explains why the limit exists rather than just refusing', () => {
    const message = tooLargeMessage('huge.bin', MAX_LOG_BYTES * 2);

    expect(message).toMatch(/browser|memory|tab/i);
  });
});
