const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

exports.sendGeneralContact = async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return ApiResponse.badRequest(res, 'Tous les champs sont requis');
  }

  // Stocker le message en DB
  const now = new Date().toISOString();
  await db.collection('general_contacts').add({ name, email, subject, message, createdAt: now });

  // Envoyer un email de notification à l'équipe via Brevo
  const adminEmail = process.env.EMAIL_FROM || 'noreply@ludra.cm';
  const html = `
    <h2>Nouveau message de contact — Ludra-Home</h2>
    <p><strong>Nom :</strong> ${name}</p>
    <p><strong>Email :</strong> ${email}</p>
    <p><strong>Sujet :</strong> ${subject}</p>
    <p><strong>Message :</strong></p>
    <blockquote>${message}</blockquote>
  `;

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com', port: 587, secure: false,
      auth: { user: process.env.BREVO_SMTP_LOGIN, pass: process.env.BREVO_SMTP_KEY },
    });
    await transporter.sendMail({
      from: `"Ludra-Home Contact" <${adminEmail}>`,
      to: adminEmail,
      replyTo: email,
      subject: `[Contact] ${subject} — ${name}`,
      html,
    });
  } catch { /* log only */ }

  return ApiResponse.success(res, null, 'Message envoyé avec succès');
};
