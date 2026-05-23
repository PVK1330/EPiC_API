import nodemailer from "nodemailer";

function buildTransportOptions() {
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASS || "").trim();

  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return {
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: user && pass ? { user, pass } : undefined,
    };
  }

  const service = process.env.EMAIL_SERVICE || "gmail";
  return {
    service,
    auth: user && pass ? { user, pass } : undefined,
  };
}

const transporter = nodemailer.createTransport(buildTransportOptions());

export default transporter;