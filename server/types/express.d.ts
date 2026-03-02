declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

