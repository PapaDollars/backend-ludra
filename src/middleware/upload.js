const multer = require('multer');
const cloudinary = require('../config/cloudinary');

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Multer garde les fichiers en mémoire → on les envoie directement à Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporté. Utilisez JPEG, PNG ou WebP'), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

/**
 * Convertit un buffer multer en data URI base64 pour Cloudinary
 */
const toDataUri = (file) =>
  `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

/**
 * Upload une image de propriété vers Cloudinary
 */
const uploadToCloudinary = async (file, folder = 'properties') => {
  const result = await cloudinary.uploader.upload(toDataUri(file), {
    folder: `ludra/${folder}`,
    resource_type: 'image',
    transformation: [
      { quality: 'auto', fetch_format: 'auto' },
      { width: 1200, height: 900, crop: 'limit' },
    ],
  });
  return { url: result.secure_url, publicId: result.public_id };
};

/**
 * Upload un avatar (recadré carré 400×400 sur le visage)
 */
const uploadAvatarToCloudinary = async (file) => {
  const result = await cloudinary.uploader.upload(toDataUri(file), {
    folder: 'ludra/avatars',
    resource_type: 'image',
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' },
    ],
  });
  return { url: result.secure_url, publicId: result.public_id };
};

const uploadMultipleToCloudinary = async (files, folder = 'properties') => {
  return Promise.all(files.map((f) => uploadToCloudinary(f, folder)));
};

/**
 * Supprimer une image de Cloudinary par son publicId
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[Cloudinary] Suppression échouée:', err.message);
  }
};

module.exports = {
  upload,
  uploadToCloudinary,
  uploadAvatarToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
};
