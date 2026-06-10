export const createAdapter = () => {
  const outbox = [];
  return {
    async start() {},
    async stop() {},
    async sendMessage(_target, message) {
      outbox.push(message);
    },
    getOutbox() {
      return [...outbox];
    },
  };
};
