import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireAal2 } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAal2();
  if (!auth.ok) redirect("/login");
  if (!can({ role: auth.ctx.role }, "users:manage")) redirect("/");
  return <>{children}</>;
}
