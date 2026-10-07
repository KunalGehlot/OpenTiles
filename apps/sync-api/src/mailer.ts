// Sending sign-in emails. The service needs exactly one kind of message, so the interface is tiny
// and adapters are easy to add for whatever EU provider the operator uses.
import { createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development only: prints the message (including the sign-in link) to stdout. */
export function consoleMailer(print: (line: string) => void = console.log): Mailer {
  return {
    async send(message) {
      print(`--- email to ${message.to}: ${message.subject}\n${message.text}\n---`);
    },
  };
}

/** Tests: keeps messages in memory. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/**
 * SMTP via nodemailer. `url` is a connection string such as
 * `smtps://user:password@smtp.example.eu:465` (implicit TLS) or `smtp://...:587` (STARTTLS,
 * required).
 */
export function smtpMailer(options: { url: string; from: string }): Mailer {
  const url = new URL(options.url);
  const transport = createTransport({
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
    secure: url.protocol === 'smtps:',
    requireTLS: true,
    auth: url.username
      ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
      : undefined,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: options.from, ...message });
    },
  };
}

/**
 * Generic HTTP email API: POSTs `{ from, to, subject, text }` as JSON with a bearer token. Point
 * it at the provider's endpoint, or at a small relay that maps this shape to the provider's.
 */
export function httpMailer(options: {
  url: string;
  token: string;
  from: string;
  fetch?: typeof fetch;
}): Mailer {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(message) {
      const res = await doFetch(options.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from: options.from, ...message }),
      });
      await res.arrayBuffer();
      if (!res.ok) throw new Error(`Email API answered HTTP ${res.status}`);
    },
  };
}

/** The sign-in email, in plain British English. */
export function signInMessage(
  to: string,
  link: string,
  code: string,
  minutes: number,
): MailMessage {
  return {
    to,
    subject: 'Your OpenTiles sign-in link',
    text: [
      'Hello,',
      '',
      'Use this link to sign in to OpenTiles sync:',
      '',
      link,
      '',
      `Or type this code in the app: ${code}`,
      '',
      `The link and the code work once and expire in ${minutes} minutes.`,
      'If you did not ask to sign in, you can ignore this email; nothing will change.',
      '',
      'OpenTiles',
    ].join('\n'),
  };
}
