const crypto = require('crypto');
const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { validationError } = require('../utils/AppError');
const { uploadToCloudinary } = require('../middleware/upload');
const drafts = require('../services/drafts.service');

/** Publication « + Publier » (module 06) : brouillons, uploads, publication. */

exports.listDrafts = async (req, res) => ApiResponse.success(res, await drafts.listDrafts(req.user.id));

exports.createDraft = async (req, res) => ApiResponse.created(res, await drafts.createDraft(req.user, req.body), 'Brouillon créé');

exports.getDraft = async (req, res) => ApiResponse.success(res, await drafts.getDraft(req.user.id, req.params.id));

exports.updateDraft = async (req, res) => ApiResponse.success(res, await drafts.updateDraft(req.user.id, req.params.id, req.body), 'Brouillon enregistré');

exports.deleteDraft = async (req, res) => {
  await drafts.deleteDraft(req.user.id, req.params.id);
  return ApiResponse.success(res, null, 'Brouillon supprimé');
};

exports.publishDraft = async (req, res) => ApiResponse.success(res, await drafts.publishDraft(req.user, req.params.id), 'Publication enregistrée');

/**
 * POST /uploads (multipart : `file`, `purpose=publication_media`) → `UploadedMedia`.
 * Upload immédiat vers Cloudinary ; l'upload est enregistré (`uploads/{id}`) pour vérifier à la publication
 * que chaque photo d'un brouillon appartient bien à son auteur.
 */
exports.upload = async (req, res) => {
  if (!req.file) throw validationError([{ field: 'file', message: 'Choisissez une image.' }]);
  const purpose = req.body.purpose || 'publication_media';
  if (purpose !== 'publication_media') throw validationError([{ field: 'purpose', message: 'Usage non pris en charge.' }]);

  const { url, publicId } = await uploadToCloudinary(req.file, 'publications');
  const id = `up_${crypto.randomBytes(12).toString('hex')}`;
  await db.collection('uploads').doc(id).set({
    userId: req.user.id, purpose, url, publicId, mimeType: req.file.mimetype, size: req.file.size,
    createdAt: new Date().toISOString(),
  });
  return ApiResponse.created(res, { id, url, type: 'image' }, 'Image téléversée');
};
