// The app-wide middleware that makes `user` available in every EJS
// template without passing it into every single res.render() call.
// Mount this AFTER passport's session middleware and BEFORE your routers.
function attachUserToLocals(req, res, next) {
  res.locals.user = req.user || null;
  next();
}

module.exports = { attachUserToLocals };