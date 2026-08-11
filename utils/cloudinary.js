const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/*
  Shared upload plumbing for every image the app accepts from a browser
  form (event banners/galleries, student profile photos) — one
  CloudinaryStorage engine, parameterized by folder, reused by whichever
  multer instance a route needs. Uploads stream straight to Cloudinary;
  nothing ever touches local disk, and the DB only ever stores the
  resulting secure_url (see models/EventImage.js, User.updatePhoto).
*/
// allowedFormats gates what Cloudinary will accept at all — pass null to
// lift the restriction entirely (accept any image Cloudinary can decode,
// including phone formats like heic/heif that browsers can't render and
// docx's ImageRun can't embed).
//
// format, separately, forces Cloudinary to CONVERT whatever came in to a
// specific format on upload — e.g. logbookRouter passes format: 'jpg' so
// a HEIC photo straight off an iPhone still lands as a jpg, which is both
// what docx's ImageRun knows how to embed and what a plain <img src> can
// render (raw HEIC can't do either). Without this, restricting
// allowedFormats to just ['jpg','jpeg','png'] silently rejects most phone
// photos before they ever reach Cloudinary — the upload throws, and
// nothing downstream (DB row, docx embed) ever happens.
function makeUploader(folder, { allowedFormats = null, format } = {}) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `techrush/${folder}`,
      ...(allowedFormats ? { allowed_formats: allowedFormats } : {}),
      ...(format ? { format } : {}),
      transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    },
  });
  return multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
}

module.exports = { cloudinary, makeUploader };
