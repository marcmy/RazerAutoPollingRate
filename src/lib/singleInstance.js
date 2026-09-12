function acquireSingleInstanceLock(app) {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    app.quit();
  }
  return acquired;
}

module.exports = { acquireSingleInstanceLock };
