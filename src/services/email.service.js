const nodemailer = require('nodemailer');

const otpHtml = (code, type) => {
  const isReset = type === 'reset';
  const intro = isReset
    ? 'Utilisez le code ci-dessous pour réinitialiser votre mot de passe.'
    : 'Utilisez le code ci-dessous pour confirmer votre adresse email.';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
  .container{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .header{background:#103778;padding:32px 40px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:24px}
  .header span{color:#FF5A33}
  .body{padding:40px;text-align:center}
  .body p{color:#555;line-height:1.6;margin:0 0 16px;text-align:left}
  .code{font-size:48px;font-weight:bold;letter-spacing:12px;color:#103778;margin:24px 0;font-family:monospace}
  .warning{background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;color:#92400e;font-size:13px;text-align:left;margin-top:24px}
  .footer{padding:20px 40px;background:#f9f9f9;color:#999;font-size:12px;text-align:center}
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Ludra<span>-Home</span></h1></div>
  <div class="body">
    <p>Bonjour,</p>
    <p>${intro}</p>
    <div class="code">${code}</div>
    <div class="warning">⚠️ Ce code expire dans <strong>10 minutes</strong>. Ne le partagez avec personne.</div>
  </div>
  <div class="footer">© ${new Date().getFullYear()} Ludra-Home — Trouvez votre logement idéal</div>
</div>
</body>
</html>`;
};

const resetLinkHtml = (resetUrl) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
  .container{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .header{background:#103778;padding:32px 40px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:24px}
  .header span{color:#FF5A33}
  .body{padding:40px}
  .body p{color:#555;line-height:1.6;margin:0 0 16px}
  .btn{display:inline-block;background:#FF5A33;color:#fff!important;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;font-size:16px;margin:24px 0}
  .footer{padding:20px 40px;background:#f9f9f9;color:#999;font-size:12px;text-align:center}
  .warning{background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;color:#92400e;font-size:13px}
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Ludra<span>-Home</span></h1></div>
  <div class="body">
    <p>Bonjour,</p>
    <p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
    <div style="text-align:center"><a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe</a></div>
    <div class="warning">⚠️ Ce lien expire dans <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.</div>
    <p style="margin-top:24px;font-size:13px;color:#999">Si le bouton ne fonctionne pas :<br><a href="${resetUrl}" style="color:#103778;word-break:break-all">${resetUrl}</a></p>
  </div>
  <div class="footer">© ${new Date().getFullYear()} Ludra-Home — Trouvez votre logement idéal</div>
</div>
</body>
</html>`;

const sendViaBrevoAPI = async (to, subject, htmlContent) => {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Ludra-Home', email: process.env.SMTP_FROM || process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo API ${res.status}: ${text}`);
  }
};

const sendViaGmailFallback = (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  transporter.sendMail({ from: `"Ludra-Home" <${process.env.EMAIL_USER}>`, to, subject, html })
    .catch(err => console.error('[EMAIL FALLBACK]', err.message));
};

const envoyerCode = async (to, code, type) => {
  const subject = type === 'reset'
    ? 'Réinitialisation de mot de passe — Ludra-Home'
    : 'Code de vérification — Ludra-Home';
  const html = otpHtml(code, type);

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevoAPI(to, subject, html);
  } else {
    sendViaGmailFallback(to, subject, html);
  }
};

const sendResetPassword = async (email, resetUrl) => {
  const subject = 'Réinitialisation de votre mot de passe — Ludra-Home';
  const html = resetLinkHtml(resetUrl);

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevoAPI(email, subject, html);
  } else {
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: process.env.BREVO_SMTP_LOGIN, pass: process.env.BREVO_SMTP_KEY },
    });
    await transporter.sendMail({
      from: `"Ludra-Home" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject,
      html,
    });
  }
};

module.exports = { envoyerCode, sendResetPassword };
