import { useLocation } from "wouter";
import { SignUp } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function localModeEnabled(): boolean {
  return import.meta.env.DEV;
}

export default function Register() {
  const [, setLocation] = useLocation();

  if (clerkPublishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
        />
      </div>
    );
  }

  if (!localModeEnabled()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account Setup Unavailable</CardTitle>
            <CardDescription>
              Set VITE_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY before using sign-up in production.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account Setup Disabled</CardTitle>
          <CardDescription>
            This app is running as a local internal content tool. Use the dashboard directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => setLocation("/blog")}>
            Open Blog Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
