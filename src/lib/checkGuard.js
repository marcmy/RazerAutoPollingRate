function createCheckGuard() {
  let running = false;

  return {
    isRunning() {
      return running;
    },

    async run(work) {
      if (running) {
        return { skipped: true };
      }

      running = true;
      try {
        const result = await work();
        return { skipped: false, result };
      } finally {
        running = false;
      }
    },
  };
}

module.exports = {
  createCheckGuard,
};
