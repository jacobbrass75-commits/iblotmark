import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const app = clerkPublishableKey ? (
  <ClerkProvider publishableKey={clerkPublishableKey}>
    <App />
  </ClerkProvider>
) : (
  <App />
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {app}
  </StrictMode>
);
