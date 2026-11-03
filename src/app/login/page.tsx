import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getDemoSession } from "@/lib/auth";
import { getDemoAuthEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getDemoSession()) redirect("/");
  const { email, password } = getDemoAuthEnv();
  return <LoginForm demoEmail={email} demoPassword={password} />;
}
