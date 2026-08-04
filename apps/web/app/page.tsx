import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

/** Root is a router: signed-in users go to the dashboard, everyone else logs in. */
export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? "/dashboard" : "/login");
}
