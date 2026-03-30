module.exports = {
  Mppx: class Mppx {
    static create(opts) {
      return new Mppx(opts);
    }
    constructor() {
      this.multiversx = {
        charge: jest.fn().mockImplementation((opts) => opts),
      };
    }
    compose = jest.fn().mockImplementation(() => {
      // Return a function that simulates the compose execution
      return async (req) => {
        return {
          status: 402,
          challenge: {
            headers: new Map([['www-authenticate', 'MPP mock-challenge']]),
            text: async () => 'mock-challenge-body',
          },
          withReceipt: jest.fn().mockImplementation(() => ({
            headers: new Map(),
            text: async () => 'receipt-body',
          })),
        };
      };
    });
  },
};
