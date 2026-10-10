import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const suffix = sp.denied ? "?error=" + encodeURIComponent("You don't have access to that page.") : "";
  if (can.submitOwnUpdates(user.role)) redirect("/me" + suffix);
  redirect("/admin" + suffix);
}
