import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '@/lib/logger';

const FROM = 'no-reply@ajoconnect.com';

/** Build a transporter: prefers AWS SES when credentials are present, falls back to Gmail SMTP. */
function buildTransporter(): Transporter {
  if (
    process.env.AWS_SES_ACCESS_KEY_ID &&
    process.env.AWS_SES_SECRET_ACCESS_KEY &&
    process.env.AWS_SES_REGION
  ) {
    return nodemailer.createTransport({
      host: `email-smtp.${process.env.AWS_SES_REGION}.amazonaws.com`,
      port: 465,
      secure: true,
      auth: {
        user: process.env.AWS_SES_ACCESS_KEY_ID,
        pass: process.env.AWS_SES_SECRET_ACCESS_KEY,
      },
    });
  }

  // Fallback: Gmail SMTP (App Password required when 2FA is enabled)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

const transporter = buildTransporter();

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`Email sent to ${to}`);
  } catch (error) {
    logger.error('Email send failed', error);
  }
}

export async function sendPayoutAlert(email: string, userName: string, amount: number): Promise<void> {
  const subject = "It's your turn — payout ready!";
  const html = `
    <p>Hi ${userName},</p>
    <p>Your payout of <strong>${amount} XLM</strong> is ready to claim.</p>
    <p>Log in to your Ajo dashboard to claim it.</p>
  `;
  await sendMail(email, subject, html);
}

export async function sendContributionReminder(
  email: string,
  userName: string,
  amount: number,
  circleName: string,
): Promise<void> {
  const subject = `Contribution due for ${circleName}`;
  const html = `
    <p>Hi ${userName},</p>
    <p>Your contribution of <strong>${amount} XLM</strong> is due for the circle
    <strong>${circleName}</strong>. Please contribute before the deadline.</p>
  `;
  await sendMail(email, subject, html);
}
