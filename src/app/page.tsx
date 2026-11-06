import { redirect } from "next/navigation";

// The proxy sends signed-out visitors to /login; everyone else lands on the dashboard.
export default function Home() {
  redirect("/dashboard");
}
