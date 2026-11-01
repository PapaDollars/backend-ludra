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

// ─── Médias de publication (POST /uploads) : 10 Mo, un seul fichier ─────────
const PUBLICATION_MAX_SIZE = 10 * 1024 * 1024;
const publicationMulter = multer({
  storage,
  limits: { fileSize: PUBLICATION_MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Format non supporté. Utilisez JPG, PNG ou WebP.');
    err.statusCode = 422;
    return cb(err, false);
  },
});

/** Champ `file` ; erreurs multer converties en réponses 4xx lisibles (au lieu d'une 500). */
const uploadPublicationFile = (req, res, next) => {
  publicationMulter.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, code: 'FILE_TOO_LARGE', message: 'Image trop volumineuse (10 Mo maximum).' });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: 'Envoyez une seule image dans le champ « file ».' });
    }
    return res.status(err.statusCode || 400).json({ success: false, code: 'UNSUPPORTED_FORMAT', message: err.message });
  });
};

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
  uploadPublicationFile,
  uploadToCloudinary,
  uploadAvatarToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
};
