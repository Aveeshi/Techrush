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
function makeUploader(folder) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `techrush/${folder}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
      transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    },
  });
  return multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
}

module.exports = { cloudinary, makeUploader };
