"use client";

import { AlertTriangle, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AuthStatusCardProps = {
  loginUrl: string;
};

export function AuthStatusCard({ loginUrl }: AuthStatusCardProps) {
  return (
    <Card className="border-danger/25">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-danger" />
          <div>
            <p className="text-sm font-semibold text-danger">Zerodha login required</p>
            <p className="mt-1 text-sm text-slate-300">
              The saved access token is missing or expired. Log in again before starting the scheduler.
            </p>
          </div>
        </div>
        <Button asChild variant="destructive">
          <a href={loginUrl}>
            Re-login
            <LogIn className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
