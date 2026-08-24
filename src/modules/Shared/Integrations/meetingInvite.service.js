// Meeting Invite Service
//
// Emails the join link to everyone on a calendar meeting. The calendar module
// used to persist `attendees` as JSON and stop there: the Teams/Meet link only
// ever existed inside the app, so an invited person was never actually told
// about their own meeting.
//
// Provider-sent invitations (Outlook, Google Calendar) still go out on top of
// this where a provider is connected. This mail is the one that always lands —
// it is branded, it works for plain in-app meetings with no provider at all, and
// it reaches attendees whose mail host silently drops .ics invitations.

import logger from '../../../utils/logger.js';
import { sendTransactionalEmail } from '../../../services/mail.service.js';
import { getOrganisationEmailBranding } from '../../../utils/emailBranding.js';
import { generateMeetingInviteTemplate } from '../../../utils/emailTemplates.js';
import { isValidEmailAddress } from '../../../services/mail.service.js';

const PLATFORM_LABELS = {
  microsoft: 'Microsoft Teams',
  teams: 'Microsoft Teams',
  google: 'Google Meet',
  google_meet: 'Google Meet',
};

const SUBJECT_PREFIX = {
  created: 'Meeting invitation',
  updated: 'Meeting updated',
  cancelled: 'Meeting cancelled',
};

/** Attendees arrive as either "a@b.com" or { email, type } — accept both. */
export const extractAttendeeEmails = (attendees) => {
  if (!Array.isArray(attendees)) return [];
  const seen = new Set();
  const emails = [];
  for (const entry of attendees) {
    const raw = typeof entry === 'string' ? entry : entry?.email;
    const email = String(raw || '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
};

const formatWhen = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return {
    date: d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    time: d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }),
  };
};

/**
 * Sends the meeting mail to every attendee, plus the organiser.
 *
 * Deliberately per-recipient: one bad address must not stop the rest, and no
 * failure here may fail the request that created the meeting — the meeting is
 * already saved by the time this runs.
 *
 * @param {object} params
 * @param {object} params.tenantDb
 * @param {object} params.meeting  Plain CalendarMeeting row (or normalised object)
 * @param {number} params.organiserId
 * @param {number} params.organisationId
 * @param {'created'|'updated'|'cancelled'} params.variant
 * @returns {Promise<{attempted:number, sent:number, failed:number, skipped:string[]}>}
 */
export const sendMeetingInvites = async ({
  tenantDb,
  meeting,
  organiserId,
  organisationId,
  variant = 'created',
}) => {
  const outcome = { attempted: 0, sent: 0, failed: 0, skipped: [] };

  const attendeeEmails = extractAttendeeEmails(meeting?.attendees);

  let organiser = null;
  try {
    if (organiserId && tenantDb?.User) {
      organiser = await tenantDb.User.findByPk(organiserId, {
        attributes: ['id', 'first_name', 'last_name', 'email'],
      });
    }
  } catch (err) {
    logger.warn({ err, organiserId }, 'Could not load meeting organiser for invite email');
  }

  const organiserName = organiser
    ? [organiser.first_name, organiser.last_name].filter(Boolean).join(' ').trim()
    : '';
  const organiserEmail = organiser?.email ? String(organiser.email).trim() : '';

  // The organiser gets a copy so they hold the same link they sent out.
  const recipients = [...attendeeEmails];
  if (organiserEmail && !recipients.some((e) => e.toLowerCase() === organiserEmail.toLowerCase())) {
    recipients.push(organiserEmail);
  }

  if (!recipients.length) return outcome;

  let branding = {};
  try {
    branding = await getOrganisationEmailBranding(organisationId);
  } catch (err) {
    logger.warn({ err, organisationId }, 'Falling back to default branding for meeting invite');
  }

  const { date, time } = formatWhen(meeting.start_time);
  const platformKey = String(meeting.meeting_provider || '').toLowerCase();
  const platform = PLATFORM_LABELS[platformKey] || (meeting.location || '');

  const html = generateMeetingInviteTemplate({
    branding,
    subject: meeting.subject,
    description: meeting.description || '',
    date,
    time,
    platform,
    meetingUrl: meeting.join_url || '',
    location: !platformKey ? meeting.location || '' : '',
    organiserName: organiserName || branding?.orgName,
    attendees: attendeeEmails,
    variant,
  });

  const subject = `${SUBJECT_PREFIX[variant] || SUBJECT_PREFIX.created}: ${meeting.subject}`;

  for (const to of recipients) {
    if (!isValidEmailAddress(to)) {
      outcome.skipped.push(to);
      continue;
    }

    outcome.attempted += 1;
    try {
      const result = await sendTransactionalEmail({
        to,
        subject,
        html,
        organisationId,
        failureContext: `calendar_meeting_${variant}`,
      });
      if (result?.sent) {
        outcome.sent += 1;
      } else {
        outcome.failed += 1;
        logger.warn({ to, reason: result?.reason }, 'Meeting invite email not delivered');
      }
    } catch (err) {
      outcome.failed += 1;
      logger.error({ err, to }, 'Failed to send meeting invite email');
    }
  }

  logger.info(
    { meetingId: meeting.id, variant, ...outcome },
    'Meeting invite emails dispatched',
  );
  return outcome;
};
