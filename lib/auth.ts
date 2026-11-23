import { cookies } from "next/headers";
import { db } from "./db";
export const DEMO_USERS = [
  { email: "admin@careflow.demo", label: "Practice administrator", role: "ADMIN" },
  { email: "provider@careflow.demo", label: "Physician", role: "PROVIDER" },
  { email: "frontdesk@careflow.demo", label: "Receptionist", role: "RECEPTIONIST" },
] as const;
export async function currentUser() {
  const email = (await cookies()).get("careflow_demo_user")?.value;
  if (!email) return null;
  return db.user.findUnique({ where: { email }, include: { practice: true } });
}
export function can(role: string, allowed: string[]) { return allowed.includes(role); }
