/**
 * Week 8: Automated welcome email drip sequence.
 *
 * Runs daily via cron (trial-drip-emails job at 10:00 IST).
 * Tracks sent emails in org.onboarding_steps to prevent duplicates.
 *
 * Sequence:
 *   - welcome         → sent immediately on account creation (via superadminOrganisation.controller)
 *   - trial_day7      → 7 days after trial start: "Your trial is halfway through"
 *   - trial_day14     → 14 days after trial start (= expiry day): "Your trial ends today"
 *   - conversion_nudge→ 1 day after trial expired: "Upgrade to keep access"
 */
import { Op } from 'sequelize';
import platformDb from '../models/index.js';
import { sendTransactionalEmail } from './mail.service.js';
import { getOrganisationEmailBranding } from '../utils/emailBranding.js';
import logger from '../utils/logger.js';

const ONE_DAY = 24 * 60 * 60 * 1000;

function trialDaysRemaining(trialEndsAt) {
  if (!trialEndsAt) return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / ONE_DAY);
}

async function sendDripEmail(org, emailKey, subject, html) {
  try {
    await sendTransactionalEmail({ to: org.primaryEmail, subject, html, organisationId: org.id });
    const steps = { ...(org.onboarding_steps || {}), [emailKey]: new Date().toISOString() };
    await org.update({ onboarding_steps: steps });
    logger.info({ orgId: org.id, emailKey }, 'Drip email sent');
    return true;
  } catch (err) {
    logger.error({ err, orgId: org.id, emailKey }, 'Drip email failed');
    return false;
  }
}

function buildEmail(orgName, type, daysLeft) {
  const templates = {
    trial_day7: {
      subject: `${orgName} — Your trial has 7 days remaining`,
      html: `<h2>Your EPiC trial is going well!</h2>
<p>Hi ${orgName} team,</p>
<p>You have <strong>7 days left</strong> in your free trial. Make the most of it:</p>
<ul>
  <li>Add your team members under Settings → Users</li>
  <li>Create your first immigration case</li>
  <li>Set up your sponsor compliance profile</li>
</ul>
<p><a href="${process.env.FRONTEND_URL || 'https://app.epiccms.com'}/billing" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Choose a Plan</a></p>
<p>Questions? Reply to this email and we'll help you get set up.</p>`,
    },
    trial_day14: {
      subject: `${orgName} — Your trial expires today`,
      html: `<h2>Your free trial ends today</h2>
<p>Hi ${orgName} team,</p>
<p>Your EPiC CMS free trial expires <strong>today</strong>. Upgrade now to keep uninterrupted access to all your cases, candidates and compliance data.</p>
<p><a href="${process.env.FRONTEND_URL || 'https://app.epiccms.com'}/billing" style="background:#ef4444;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Upgrade Now — Keep Access</a></p>
<p>Not ready? Your data is safe. You can reactivate any time.</p>`,
    },
    conversion_nudge: {
      subject: `${orgName} — Your trial has ended. Come back!`,
      html: `<h2>We'd love to have you back</h2>
<p>Hi ${orgName} team,</p>
<p>Your EPiC CMS trial ended yesterday. Your data is safely preserved — just upgrade to restore full access.</p>
<p><strong>What you'll get:</strong></p>
<ul>
  <li>Unlimited cases &amp; candidates</li>
  <li>Full sponsor compliance suite</li>
  <li>Automated reminders &amp; reporting</li>
  <li>Multi-user team access</li>
</ul>
<p><a href="${process.env.FRONTEND_URL || 'https://app.epiccms.com'}/billing" style="background:#22c55e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reactivate My Account</a></p>`,
    },
  };
  return templates[type] || null;
}

export async function sendTrialDripEmails() {
  const results = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  const subs = await platformDb.Subscription.findAll({
    where: {
      status: { [Op.in]: ['trial', 'expired'] },
      trial_ends_at: { [Op.not]: null },
    },
    include: [
      {
        model: platformDb.Organisation,
        as: 'organisation',
        required: true,
        where: { status: { [Op.in]: ['trial', 'suspended'] } },
        attributes: ['id', 'name', 'primaryEmail', 'onboarding_steps', 'status'],
      },
    ],
  });

  for (const sub of subs) {
    const org = sub.organisation;
    if (!org || !org.primaryEmail) continue;

    results.processed++;
    const steps = org.onboarding_steps || {};
    const daysLeft = trialDaysRemaining(sub.trial_ends_at);

    let sent = false;

    if (daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && !steps.trial_day7) {
      const tpl = buildEmail(org.name, 'trial_day7', daysLeft);
      if (tpl) sent = await sendDripEmail(org, 'trial_day7', tpl.subject, tpl.html);
    } else if (daysLeft !== null && daysLeft <= 0 && daysLeft > -1 && !steps.trial_day14) {
      const tpl = buildEmail(org.name, 'trial_day14', daysLeft);
      if (tpl) sent = await sendDripEmail(org, 'trial_day14', tpl.subject, tpl.html);
    } else if (daysLeft !== null && daysLeft <= -1 && daysLeft > -2 && !steps.conversion_nudge) {
      const tpl = buildEmail(org.name, 'conversion_nudge', daysLeft);
      if (tpl) sent = await sendDripEmail(org, 'conversion_nudge', tpl.subject, tpl.html);
    } else {
      results.skipped++;
      continue;
    }

    if (sent) results.sent++;
    else results.errors++;
  }

  return results;
}

/**
 * Send the welcome email immediately when an organisation is created.
 * Called from superadminOrganisation.controller.js after org + admin user created.
 */
export async function sendOrganisationWelcomeEmail(org, adminUser) {
  const orgName = org.name || 'Your Organisation';
  const loginUrl = `${process.env.FRONTEND_URL || 'https://app.epiccms.com'}/login`;

  const html = `<h2>Welcome to EPiC CMS! 🎉</h2>
<p>Hi ${adminUser.first_name || 'there'},</p>
<p>Your organisation <strong>${orgName}</strong> is ready. Your free 14-day trial has started.</p>
<p><strong>Your login details:</strong></p>
<ul>
  <li>Email: ${adminUser.email}</li>
  <li>Password: Check your admin credentials email</li>
</ul>
<p><strong>Quick-start checklist:</strong></p>
<ol>
  <li>Complete your <a href="${loginUrl}">organisation profile</a></li>
  <li>Invite your team members</li>
  <li>Create your first immigration case</li>
  <li>Choose a plan before your trial ends in 14 days</li>
</ol>
<p><a href="${loginUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Log In to EPiC CMS</a></p>`;

  try {
    await sendTransactionalEmail({
      to: adminUser.email,
      subject: `Welcome to EPiC CMS — ${orgName} is ready`,
      html,
      organisationId: org.id,
    });

    const steps = { ...(org.onboarding_steps || {}), welcome_sent: new Date().toISOString() };
    await platformDb.Organisation.update({ onboarding_steps: steps }, { where: { id: org.id } });
  } catch (err) {
    logger.error({ err, orgId: org.id }, 'Failed to send org welcome email');
  }
}
