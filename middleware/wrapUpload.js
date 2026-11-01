// Wraps a multer (Cloudinary-backed) upload middleware so a failed upload
// always reaches downstream error handling as a real Error with a readable
// .message.
//
// Why this exists: when Cloudinary rejects an upload (invalid/corrupt
// image, wrong format, etc.), its Node SDK calls back with a PLAIN OBJECT —
// e.g. { message: 'Invalid image file', name: 'Error', http_code: 400 } —
// NOT an actual Error instance (verified directly against the installed
// cloudinary package). The upload middleware can pass that object through
// to Express, so normalize it before downstream error handling.
function wrapUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof Error) return next(err);
      next(new Error(err?.message || 'Upload failed — please try a different file.'));
    });
  };
}

module.exports = wrapUpload;
