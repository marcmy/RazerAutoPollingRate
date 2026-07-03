'use strict';

async function retryImmediately(callback, options = {}) {
  const attempts = options.attempts ?? 3;
  const onFailure = options.onFailure ?? (() => undefined);

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be a positive integer');
  }

  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callback(attempt);
    } catch (error) {
      finalError = error;
      await onFailure(error, attempt, attempts);
    }
  }

  throw finalError;
}

module.exports = { retryImmediately };
