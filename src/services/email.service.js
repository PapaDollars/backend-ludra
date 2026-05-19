const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendResetPassword = async (email, resetUrl) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
        .header { background: #103778; padding: 32px 40px; text-align: center; }
        .header h1 { color: #fff; margin: 0; font-size: 24px; }
        .header span { color: #FF5A33; }
        .body { padding: 40px; }
        .body p { color: #555; line-height: 1.6; margin: 0 0 16px; }
        .btn { display: inline-block; background: #FF5A33; color: #fff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 24px 0; }
        .footer { padding: 20px 40px; background: #f9f9f9; color: #999; font-size: 12px; text-align: center; }
        .warning { background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; color: #92400e; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Ludra<span>-Home</span></h1>
        </div>
        <div class="body">
          <p>Bonjour,</p>
          <p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
          <div style="text-align:center">
            <a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe</a>
          </div>
          <div class="warning">
            ⚠️ Ce lien expire dans <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.
          </div>
          <p style="margin-top:24px;font-size:13px;color:#999;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${resetUrl}" style="color:#103778;word-break:break-all;">${resetUrl}</a></p>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} Ludra-Home — Trouvez votre logement idéal
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"Ludra-Home" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: 'Réinitialisation de votre mot de passe — Ludra-Home',
    html,
  });
};

module.exports = { sendResetPassword };
