import logger from '../utils/logger.js';
import { sendTransactionalEmail } from './mail.service.js';
import { getOrganisationEmailBranding } from '../utils/emailBranding.js';
import { generateCaseAssignmentEmailTemplate } from '../utils/emailTemplates.js';
import { buildCaseworkerDirectCaseUrl } from '../utils/crmUrl.util.js';

/**
 * Sends a clear, professional case assignment email to a Caseworker with a direct CRM portal link.
 *
 * Guaranteed business & reliability rules:
 *   - NEVER throws an unhandled error that breaks case assignment (best-effort dispatch).
 *   - Uses the canonical single-case URL format: /caseworker/cases?caseId=<caseId>.
 *   - Sanitizes dynamic parameters to prevent HTML/XSS injection.
 *   - Resolves organisation branding for the sending tenant.
 *
 * @param {object} opts
 * @param {object} opts.tenantDb
 * @param {number|null} [opts.organisationId]
 * @param {object} opts.caseworker - { id, email, first_name, last_name, organisation_id }
 * @param {object} opts.caseData   - { id, caseId, candidateName, visaType, assignedBy, assignedDate }
 * @param {string} [opts.directCaseUrl] - Optional precomputed URL
 * @returns {Promise<boolean>} true if queued/sent successfully, false otherwise
 */
export async function sendCaseAssignmentEmail({
  tenantDb,
  organisationId = null,
  caseworker,
  caseworkerEmail = null,
  caseworkerName = null,
  caseData = {},
  candidateName: flatCandidateName = null,
  caseNumber: flatCaseNumber = null,
  visaType: flatVisaType = null,
  assignedDate: flatAssignedDate = null,
  assignedBy: flatAssignedBy = null,
  directCaseUrl = null,
  orgName = null,
  emailService = null,
}) {
  const emailTo = caseworkerEmail || caseworker?.email;
  if (!emailTo) {
    logger.warn(
      { caseworkerId: caseworker?.id, caseId: caseData?.caseId || flatCaseNumber },
      'Caseworker has no email address — skipping assignment email'
    );
    return false;
  }

  const caseNumber = flatCaseNumber || caseData.caseId || (caseData.id != null ? String(caseData.id) : 'New Case');
  const candidateName = flatCandidateName || caseData.candidateName || 'Client';

  try {
    const resolvedOrgId =
      organisationId ??
      caseworker?.organisation_id ??
      caseData?.organisation_id ??
      null;

    const branding = await getOrganisationEmailBranding(resolvedOrgId).catch(() => null);

    const targetUrl = directCaseUrl || buildCaseworkerDirectCaseUrl(caseNumber);

    const recipientName =
      caseworkerName ||
      (caseworker && [caseworker.first_name, caseworker.last_name].filter(Boolean).join(' ').trim()) ||
      caseworker?.first_name ||
      'there';

    const subject = `New Case Assigned to You – ${candidateName} – ${caseNumber}`;

    const html = generateCaseAssignmentEmailTemplate({
      branding: branding || {},
      recipientName,
      candidateName,
      caseNumber,
      visaType: flatVisaType || caseData.visaType || '',
      assignedDate: flatAssignedDate || caseData.assignedDate || '',
      assignedBy: flatAssignedBy || caseData.assignedBy || 'Admin',
      actionUrl: targetUrl,
      orgName: orgName || branding?.orgName || '',
    });

    const sendFn = emailService?.sendTransactionalEmail || sendTransactionalEmail;
    await sendFn({
      organisationId: resolvedOrgId,
      to: emailTo,
      subject,
      html,
    });

    logger.info(
      {
        caseworkerId: caseworker?.id,
        email: emailTo,
        caseNumber,
        candidateName,
      },
      'Case assignment email dispatched successfully'
    );
    return { success: true };
  } catch (err) {
    logger.error(
      {
        err,
        caseworkerId: caseworker?.id,
        email: caseworker?.email,
        caseNumber,
      },
      'Failed to send case assignment email'
    );
    // Best-effort delivery: return false rather than throwing so assignment is preserved
    return { success: false, error: err?.message };
  }
}
