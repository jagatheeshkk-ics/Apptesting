import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT ? Number(SMTP_PORT) : 587,
    secure: SMTP_PORT === "465",
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const subject = "Your AppTesting Agent verification code";
  const text = `Your verification code is ${code}. It expires in 15 minutes.`;

  const t = getTransporter();
  if (!t) {
    // No SMTP configured — log the code so the flow is still testable end-to-end.
    console.log(`[mailer] SMTP not configured; verification code for ${to}: ${code}`);
    return;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || "no-reply@apptesting.local",
    to,
    subject,
    text,
  });
}
