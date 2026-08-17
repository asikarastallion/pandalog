/**
 * Golden verification output — doc 03 §6, doc 05 Phase F acceptance:
 *
 * > Requirement evaluation is deterministic across repeated runs on the same fixture.
 *
 * This runs the entire pipeline a user would: ingest a real `.BIN`, detect events, run the analysis
 * rules, then verify the requirement set against all three. A change anywhere beneath — a decoded
 * field, a unit conversion, a detector threshold, a rule criterion — surfaces as a diff in the
 * committed outcome, which is what makes a verification report reproducible rather than merely
 * repeatable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createDefaultRuleRegistry, runAnalysis } from '@pandalog/analysis';
import { createDefaultDetectorRegistry, detectEvents } from '@pandalog/events';
import { createAdapterRegistry, ingest } from '@pandalog/ingestion';
import { arduPilotAdapter } from '@pandalog/parser-ardupilot';
import {
  PROVISIONAL_REQUIREMENT_SET_V1,
  verifyRequirements,
  type RequirementContext,
} from '@pandalog/verification';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const adapters = createAdapterRegistry([arduPilotAdapter]);
const detectors = createDefaultDetectorRegistry();
const rules = createDefaultRuleRegistry();
const now = () => new Date('2026-01-01T00:00:00.000Z');

async function buildContext(name: string): Promise<RequirementContext> {
  const dataset = await ingest(
    { fileName: name, bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))) },
    { registry: adapters, now },
  );
  const events = detectEvents(detectors, { dataset });
  const { findings } = runAnalysis(rules, { dataset, events, now });

  return { dataset, events, findings, now };
}

describe.each(['nominal.bin', 'gps-glitch.bin', 'mode-change-error.bin', 'degraded-flight.bin'])(
  '%s',
  (name) => {
    it('verifies to the expected outcomes', async () => {
      const report = verifyRequirements(PROVISIONAL_REQUIREMENT_SET_V1, await buildContext(name));

      await expect(JSON.stringify(report, null, 2)).toMatchFileSnapshot(
        path.join(FIXTURES, `${name.replace(/\.bin$/, '')}.verification.json`),
      );
    });

    it('is deterministic across repeated runs (doc 03 §6)', async () => {
      const context = await buildContext(name);

      expect(JSON.stringify(verifyRequirements(PROVISIONAL_REQUIREMENT_SET_V1, context))).toBe(
        JSON.stringify(verifyRequirements(PROVISIONAL_REQUIREMENT_SET_V1, context)),
      );
    });

    it('never reports a PASS that cites nothing', async () => {
      const report = verifyRequirements(PROVISIONAL_REQUIREMENT_SET_V1, await buildContext(name));

      expect(report.evidenceRuleViolations).toEqual([]);
      for (const result of report.results) {
        if (result.outcome === 'PASS' || result.outcome === 'FAIL') {
          expect(result.evidence.length, `${result.requirementId} cited nothing`).toBeGreaterThan(
            0,
          );
        }
      }
    });
  },
);
