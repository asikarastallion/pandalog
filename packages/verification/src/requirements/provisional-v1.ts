/**
 * The first requirement set — doc 05 Phase F.
 *
 * Doc 05 allows this set to come from "a user-supplied test plan or a documented placeholder set,
 * explicitly marked provisional if invented for bootstrapping". No test plan exists in this
 * repository, so this is the placeholder set, and it says so three times over: in the set's
 * `source`, in every requirement's `statement`, and in the `reason` of every result it produces.
 *
 * Marking it `spec:` would have made the tool look authoritative and been a lie. A real programme
 * replaces this set with its own — `createRequirementSet` is exported for exactly that, and it
 * imposes the same documentation contract on a user's requirements as on these.
 */
import { createRequirementSet, type RequirementSet } from '../requirement.js';
import {
  ATTITUDE_TRACKING_REQUIREMENT,
  GNSS_AVAILABILITY_REQUIREMENT,
  VIBRATION_REQUIREMENT,
} from './analysis-backed.js';
import { NO_LOGGED_ERROR_REQUIREMENT } from './logged-error.js';

export const PROVISIONAL_REQUIREMENT_SET_V1: RequirementSet = createRequirementSet({
  id: 'pandalog-provisional',
  version: '1.0.0',
  source: 'provisional',
  description:
    'Bootstrapping requirement set. Every criterion behind it is provisional: none is traceable ' +
    'to a flight-test document, a customer test plan, or an airworthiness limit. A PASS here means ' +
    'the flight met a placeholder criterion, and must not be read as qualification evidence.',
  requirements: [
    ATTITUDE_TRACKING_REQUIREMENT,
    NO_LOGGED_ERROR_REQUIREMENT,
    GNSS_AVAILABILITY_REQUIREMENT,
    VIBRATION_REQUIREMENT,
  ],
});
