import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DEMO_USERS } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  if (!DEMO_USERS.some((u) => u.email === email)) return;
  (await cookies()).set("careflow_demo_user", email, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export default function LoginPage() {
  return <main className="min-h-screen grid place-items-center px-6"><section className="card w-full max-w-md p-8"><div className="mb-8"><p className="text-xs font-bold tracking-[.18em] text-teal">CAREFLOW PRACTICE</p><h1 className="mt-3 text-3xl font-semibold">Sign in to the demo</h1><p className="mt-2 text-sm text-slate-500">Synthetic data only. No PHI or live transactions.</p></div><form action={login} className="space-y-3">{DEMO_USERS.map((user) => <button key={user.email} name="email" value={user.email} className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-teal hover:bg-teal/5"><span className="block font-semibold">{user.label}</span><span className="text-sm text-slate-500">{user.email}</span></button>)}</form><p className="mt-7 text-xs leading-5 text-slate-500">This public management demonstration is not approved for live clinical use and does not claim HIPAA compliance.</p></section></main>;
}
