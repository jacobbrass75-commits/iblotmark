declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
    }

    interface Request {
      user?: User;
      companyId?: string;
      companyRole?: "owner" | "admin" | "editor" | "reviewer" | "viewer";
    }
  }
}

export {};
