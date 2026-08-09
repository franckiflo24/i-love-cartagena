#!/usr/bin/env node
/**
 * verify-images.mjs — repo-root SHIM.
 *
 * The canonical script now lives at frontend/scripts/verify-images.mjs so the
 * documented `cd frontend && node scripts/verify-images.mjs` runbook works. This
 * shim keeps `node scripts/verify-images.mjs` working from the repo root too.
 */
import('../frontend/scripts/verify-images.mjs');
