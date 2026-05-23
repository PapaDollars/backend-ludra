const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');
const { createNotification } = require('../utils/notifications');
const { sendResetPassword } = require('../services/email.service');

exports.sendContact = async (req, res) => {
  const { propertyId, message } = req.body;
  const user = req.user;

  const propDoc = await db.collection('properties').doc(propertyId).get();
  if (!propDoc.exists || !propDoc.data().isActive) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  const property = propDoc.data();

  // Empêcher de contacter son propre logement
  if (property.landlordId === user.id) {
    return ApiResponse.badRequest(res, 'Vous ne pouvez pas contacter votre propre propriété');
  }

  const now = new Date().toISOString();
  const contactData = {
    propertyId,
    propertyTitle: property.title,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    landlordId: property.landlordId,
    message: message.trim(),
    isRead: false,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection('contacts').add(contactData);

  // Notifier le propriétaire avec le nom et téléphone du demandeur
  await createNotification(property.landlordId, {
    type: 'contact_request',
    title: 'Nouvelle demande de contact',
    message: `${user.name} est intéressé(e) par "${property.title}" et souhaite être contacté(e).`,
    propertyId,
    propertyTitle: property.title,
    contactName: user.name,
    contactPhone: user.phone || null,
    contactEmail: user.email || null,
  });

  return ApiResponse.created(res, { id: docRef.id, ...contactData }, 'Message envoyé au propriétaire');
};

exports.getContacts = async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));
  const user = req.user;

  let contacts;

  if (user.role === 'landlord') {
    // Contacts reçus (sur ses propriétés) + contacts envoyés (vers d'autres propriétaires)
    const [receivedSnap, sentSnap] = await Promise.all([
      db.collection('contacts').where('landlordId', '==', user.id).get(),
      db.collection('contacts').where('userId', '==', user.id).get(),
    ]);
    const seen = new Set();
    contacts = [...receivedSnap.docs, ...sentSnap.docs]
      .filter((d) => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
      .map((d) => ({ id: d.id, ...d.data() }));
  } else {
    let query = db.collection('contacts');
    if (user.role === 'user') query = query.where('userId', '==', user.id);
    // admin / proprietaire voit tout
    const snap = await query.get();
    contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (unreadOnly === 'true') {
    contacts = contacts.filter((c) => !c.isRead);
  }

  contacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = contacts.length;
  const paginated = contacts.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.getContactById = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('contacts').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Contact introuvable');
  }

  const contact = { id: doc.id, ...doc.data() };
  const user = req.user;

  // Accès limité : concernés uniquement ou admin
  if (!isPrivileged(user.role) && contact.userId !== user.id && contact.landlordId !== user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  return ApiResponse.success(res, contact);
};

exports.markAsRead = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('contacts').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Contact introuvable');
  }

  if (!isPrivileged(req.user.role) && doc.data().landlordId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  await doc.ref.update({ isRead: true, updatedAt: new Date().toISOString() });

  return ApiResponse.success(res, null, 'Marqué comme lu');
};


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
