
import Link from "next/link";
import { signOut } from "@/app/actions";

const navigation = [
  { label: "Dashboard", href: "/", icon: "⌂" },
  { label: "Patients", href: "/patients", icon: "♙" },
  { label: "Schedule", href: "/schedule", icon: "▦" },
  { label: "Clinical", href: "/clinical", icon: "✚" },
  { label: "Billing", href: "/billing", icon: "$" },
  { label: "Reports", href: "/reports", icon: "▤" },
  { label: "Administration", href: "/administration", icon: "⚙" },
];

export default function AppShell({
  children,
  user,
  active,
}: {
  children: React.ReactNode;
  user: { displayName: string; role: string; practice: { name: string } };
  active: string;
}) {
  const canAccessEra = ["ADMIN", "BILLING"].includes(user.role);

  return (
    <div className="min-h-screen md:flex">
      <aside className="w-full shrink-0 bg-ink p-6 text-white md:min-h-screen md:w-64">
        <div className="text-xs font-bold tracking-[.18em] text-teal-200">
          CAREFLOW
        </div>
        <div className="mt-1 text-lg font-semibold">Practice</div>

        <div className="mt-8 rounded-xl bg-white/10 p-3">
          <div className="text-sm font-semibold">{user.practice.name}</div>
          <div className="mt-1 text-xs text-slate-300">
            {user.displayName} · {user.role}
          </div>
        </div>

        <nav className="mt-8 space-y-1" aria-label="Main navigation">
          {navigation.map((item) => (
            <div key={item.href}>
              <Link
                href={item.href}
                aria-current={active === item.label ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active === item.label
                    ? "bg-teal text-white"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>

              {item.label === "Billing" && canAccessEra && (
                <Link
                  href="/billing/era"
                  className="ml-9 mt-1 flex items-center rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                  ERA / 835 Reconciliation
                </Link>
              )}
            </div>
          ))}
        </nav>

        <form action={signOut} className="mt-10">
          <button className="text-sm text-slate-300 hover:text-white">
            Sign out
          </button>
        </form>

        <div className="mt-8 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
          DEMO ENVIRONMENT
          <br />
          Synthetic data only. Not for live clinical use.
        </div>
      </aside>

      <main className="w-full min-w-0 p-6 md:p-10">{children}</main>
    </div>
  );
}