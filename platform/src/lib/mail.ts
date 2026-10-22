import { createTransport, type Transporter } from "nodemailer";
import { smtpConfig } from "./env.ts";

let transport: Transporter | null = null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const cfg = smtpConfig();
  if (!cfg) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP не настроен");
    console.log(`\n[почта, разработка] кому: ${to}\nтема: ${subject}\n${text}\n`);
    return;
  }
  transport ??= createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
  });
  await transport.sendMail({ from: cfg.from, to, subject, text });
}

export function loginCodeMail(code: string, minutes: number) {
  return {
    subject: `Код входа ${code}`,
    text: `Ваш код для входа в ARTCHIEVE SERVICE: ${code}\n\nОн действует ${minutes} минут. Если вы не запрашивали код, просто проигнорируйте письмо.`,
  };
}
