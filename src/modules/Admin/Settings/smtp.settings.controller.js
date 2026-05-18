import platformDb from "../../../models/index.js";
import {
  getPlatformSmtpConfig,
  isSmtpConfigComplete,
  maskSmtpConfigForClient,
  parseOrganisationSmtpSettings,
  sendTransactionalEmail,
  verifyMailTransport,
} from "../../../services/mail.service.js";

function getOrganisationId(req) {
  const id = req.user?.organisation_id;
  return id != null ? Number(id) : null;
}

function normalizeSmtpPayload(body = {}) {
  const enabled =
    body.enabled === true ||
    body.use_custom_smtp === true ||
    body.useCustomSmtp === true;

  return {
    enabled,
    host: String(body.host || body.smtp_host || "").trim() || null,
    port: body.port ?? body.smtp_port ?? null,
    secure: body.secure === true || body.secure === "true",
    service: String(body.service || body.smtp_service || "").trim() || null,
    user: String(body.user || body.smtp_user || "").trim(),
    from: String(body.from || body.smtp_from || "").trim() || null,
    pass: String(body.pass || body.password || body.smtp_pass || "").trim(),
  };
}

function buildStoredSmtpSettings(existing, incoming) {
  const next = {
    enabled: incoming.enabled,
    host: incoming.host,
    port: incoming.port != null && incoming.port !== "" ? Number(incoming.port) : null,
    secure: incoming.secure,
    service: incoming.service,
    user: incoming.user,
    from: incoming.from || incoming.user,
  };

  if (incoming.pass) {
    next.pass = incoming.pass;
  } else if (existing?.pass) {
    next.pass = existing.pass;
  } else {
    next.pass = "";
  }

  return next;
}

export async function getSmtpSettings(req, res) {
  try {
    const orgId = getOrganisationId(req);
    if (!orgId) {
      return res.status(400).json({ status: "error", message: "Organisation context required" });
    }

    const org = await platformDb.Organisation.findByPk(orgId, {
      attributes: ["id", "smtp_settings"],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found" });
    }

    const orgRaw = org.smtp_settings || {};
    const orgConfig = parseOrganisationSmtpSettings(orgRaw);
    const platformConfig = getPlatformSmtpConfig();
    const platformReady = isSmtpConfigComplete(platformConfig);

    const activeSource = isSmtpConfigComplete(orgConfig)
      ? "organisation"
      : platformReady
        ? "platform"
        : "none";

    return res.json({
      status: "success",
      data: {
        organisation: maskSmtpConfigForClient(
          orgConfig || {
            source: "organisation",
            enabled: orgRaw.enabled === true,
            host: orgRaw.host || "",
            port: orgRaw.port ?? "",
            secure: orgRaw.secure,
            service: orgRaw.service || "",
            user: orgRaw.user || "",
            from: orgRaw.from || orgRaw.user || "",
          },
          { hasPassword: Boolean(orgRaw.pass) },
        ),
        platformFallback: maskSmtpConfigForClient(platformConfig, {
          hasPassword: Boolean(platformConfig?.pass),
        }),
        activeSource,
        platformConfigured: platformReady,
      },
    });
  } catch (err) {
    console.error("getSmtpSettings:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}

export async function updateSmtpSettings(req, res) {
  try {
    const orgId = getOrganisationId(req);
    if (!orgId) {
      return res.status(400).json({ status: "error", message: "Organisation context required" });
    }

    const org = await platformDb.Organisation.findByPk(orgId, {
      attributes: ["id", "smtp_settings"],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found" });
    }

    const incoming = normalizeSmtpPayload(req.body);
    const stored = buildStoredSmtpSettings(org.smtp_settings, incoming);

    if (stored.enabled && (!stored.user || !stored.pass)) {
      return res.status(400).json({
        status: "error",
        message: "SMTP user and password are required when custom SMTP is enabled",
      });
    }

    await org.update({ smtp_settings: stored.enabled ? stored : { enabled: false } });
    await org.reload();

    const orgConfig = parseOrganisationSmtpSettings(org.smtp_settings);
    const activeSource = isSmtpConfigComplete(orgConfig) ? "organisation" : "platform";

    return res.json({
      status: "success",
      message: stored.enabled
        ? "Organisation SMTP saved"
        : "Organisation SMTP disabled — platform mail will be used",
      data: {
        organisation: maskSmtpConfigForClient(orgConfig || stored, {
          hasPassword: Boolean(stored.pass),
        }),
        activeSource,
      },
    });
  } catch (err) {
    console.error("updateSmtpSettings:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}

export async function testSmtpSettings(req, res) {
  try {
    const orgId = getOrganisationId(req);
    if (!orgId) {
      return res.status(400).json({ status: "error", message: "Organisation context required" });
    }

    const to =
      String(req.body?.to || req.user?.email || "").trim() ||
      null;
    if (!to) {
      return res.status(400).json({ status: "error", message: "Recipient email required" });
    }

    const verify = await verifyMailTransport(orgId);
    if (!verify.ok) {
      return res.status(503).json({
        status: "error",
        message: verify.error || "SMTP is not configured or could not be verified",
        data: { source: verify.source },
      });
    }

    const result = await sendTransactionalEmail({
      organisationId: orgId,
      to,
      subject: "EPiC — SMTP test",
      html: `<p>This is a test email from your organisation mail settings (source: <strong>${verify.source}</strong>).</p>`,
      text: `SMTP test (${verify.source})`,
    });

    if (!result.sent) {
      return res.status(502).json({
        status: "error",
        message: result.error || "Test email could not be sent",
        data: { usedSource: result.usedSource },
      });
    }

    return res.json({
      status: "success",
      message: `Test email sent via ${result.usedSource} SMTP`,
      data: { usedSource: result.usedSource, to },
    });
  } catch (err) {
    console.error("testSmtpSettings:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}

export async function getPlatformSmtpSettings(req, res) {
  try {
    const platformConfig = getPlatformSmtpConfig();
    return res.json({
      status: "success",
      data: {
        platform: maskSmtpConfigForClient(platformConfig, {
          hasPassword: Boolean(platformConfig?.pass),
        }),
        configured: isSmtpConfigComplete(platformConfig),
        note: "Platform SMTP is configured in the API server environment (.env). Organisations without custom SMTP use these credentials.",
      },
    });
  } catch (err) {
    console.error("getPlatformSmtpSettings:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}
