/**
 * Week 8: Self-serve onboarding wizard.
 *
 * Steps (in order):
 *   1. profile_setup   — Organisation name, logo, timezone filled in
 *   2. plan_chosen     — Subscription plan selected
 *   3. team_invited    — At least one non-admin user invited
 *   4. trial_started   — Subscription status = trial or active
 *
 * Org admins call GET /api/onboarding/status to see which steps are done,
 * and POST /api/onboarding/complete-step to mark a step manually done.
 */
import catchAsync from '../../utils/catchAsync.js';
import ApiResponse from '../../utils/apiResponse.js';
import platformDb from '../../models/index.js';
import logger from '../../utils/logger.js';

const STEPS = ['profile_setup', 'plan_chosen', 'team_invited', 'trial_started'];

function stepProgress(steps) {
  const completed = STEPS.filter((s) => Boolean(steps[s]));
  const next = STEPS.find((s) => !steps[s]) || null;
  const percent = Math.round((completed.length / STEPS.length) * 100);
  return { completed, next, percent, total: STEPS.length, done: completed.length };
}

/** GET /api/onboarding/status */
export const getOnboardingStatus = catchAsync(async (req, res) => {
  const orgId = req.user?.organisation_id;
  if (!orgId) return ApiResponse.forbidden(res, 'No organisation context');

  const org = await platformDb.Organisation.findByPk(orgId, {
    attributes: ['id', 'name', 'slug', 'onboarding_steps', 'onboarding_completed_at', 'plan_id', 'status', 'logoUrl'],
  });
  if (!org) return ApiResponse.notFound(res, 'Organisation not found');

  // Auto-detect steps from current state
  const autoSteps = { ...(org.onboarding_steps || {}) };

  if (!autoSteps.profile_setup && org.name && org.logoUrl) {
    autoSteps.profile_setup = new Date().toISOString();
  }
  if (!autoSteps.plan_chosen && org.plan_id) {
    autoSteps.plan_chosen = new Date().toISOString();
  }
  if (!autoSteps.trial_started && ['trial', 'active'].includes(org.status)) {
    autoSteps.trial_started = new Date().toISOString();
  }

  const allDone = STEPS.every((s) => Boolean(autoSteps[s]));
  if (allDone && !org.onboarding_completed_at) {
    await org.update({ onboarding_steps: autoSteps, onboarding_completed_at: new Date() });
  } else if (JSON.stringify(autoSteps) !== JSON.stringify(org.onboarding_steps)) {
    await org.update({ onboarding_steps: autoSteps });
  }

  const progress = stepProgress(autoSteps);

  return ApiResponse.success(res, {
    steps: STEPS.map((key) => ({
      key,
      label: stepLabel(key),
      completed: Boolean(autoSteps[key]),
      completedAt: autoSteps[key] || null,
    })),
    progress,
    isComplete: Boolean(org.onboarding_completed_at || allDone),
    completedAt: org.onboarding_completed_at,
  });
});

/** POST /api/onboarding/complete-step */
export const completeStep = catchAsync(async (req, res) => {
  const orgId = req.user?.organisation_id;
  const { step } = req.body;

  if (!STEPS.includes(step)) {
    return ApiResponse.badRequest(res, `Invalid step. Valid: ${STEPS.join(', ')}`);
  }

  const org = await platformDb.Organisation.findByPk(orgId, {
    attributes: ['id', 'onboarding_steps', 'onboarding_completed_at'],
  });
  if (!org) return ApiResponse.notFound(res, 'Organisation not found');

  const steps = { ...(org.onboarding_steps || {}), [step]: new Date().toISOString() };
  const allDone = STEPS.every((s) => Boolean(steps[s]));

  await org.update({
    onboarding_steps: steps,
    ...(allDone && !org.onboarding_completed_at ? { onboarding_completed_at: new Date() } : {}),
  });

  logger.info({ orgId, step }, 'Onboarding step completed');
  return ApiResponse.success(res, { step, completedAt: steps[step], allDone }, 'Step completed');
});

/** GET /api/onboarding/steps — list all steps with labels (public, for wizard UI) */
export const listSteps = catchAsync(async (req, res) => {
  return ApiResponse.success(res, STEPS.map((key) => ({ key, label: stepLabel(key) })));
});

function stepLabel(key) {
  const labels = {
    profile_setup: 'Set up your organisation profile',
    plan_chosen:   'Choose a subscription plan',
    team_invited:  'Invite your team',
    trial_started: 'Start your free trial',
  };
  return labels[key] || key;
}
