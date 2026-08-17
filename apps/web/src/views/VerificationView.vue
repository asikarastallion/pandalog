<script setup lang="ts">
/**
 * Verification — four outcomes, shown as four outcomes.
 *
 * Its own view rather than a block at the foot of a page (doc 01 §5.1 rule 2). `INCONCLUSIVE` and
 * `NOT_APPLICABLE` are answers, not degraded passes, and the whole product rests on that
 * distinction being legible (doc 03 §3).
 */
import type { VerificationReport } from '@pandalog/verification';

import VerificationPanel from '../components/VerificationPanel.vue';

defineProps<{ verification: VerificationReport }>();
</script>

<template>
  <div class="verification-view">
    <VerificationPanel :report="verification" />
  </div>
</template>

<style scoped>
.verification-view {
  max-width: 56rem;
}
</style>
