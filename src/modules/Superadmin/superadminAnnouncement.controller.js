import { broadcastPlatformAnnouncement } from '../../services/announcement.service.js';

export const createPlatformAnnouncement = async (req, res) => {
  try {
    const { target = 'all', orgIds = [], title, message, sendEmail = true } = req.body || {};

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required',
        data: null,
      });
    }

    const normalizedTarget = target === 'selected' ? 'selected' : 'all';

    if (normalizedTarget === 'selected') {
      const ids = Array.isArray(orgIds) ? orgIds : [];
      if (!ids.length) {
        return res.status(400).json({
          status: 'error',
          message: 'orgIds is required when target is selected',
          data: null,
        });
      }
    }

    const summary = await broadcastPlatformAnnouncement({
      target: normalizedTarget,
      orgIds,
      title: title.trim(),
      message: message.trim(),
      sendEmail: sendEmail !== false,
    });

    return res.status(200).json({
      status: 'success',
      message: `Announcement sent to ${summary.recipients} organisation admin(s) across ${summary.organisations} organisation(s).`,
      data: { summary },
    });
  } catch (err) {
    console.error('createPlatformAnnouncement error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to send announcement',
      data: null,
    });
  }
};
