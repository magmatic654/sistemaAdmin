import { businessToday } from "@/lib/domain";
import Dashboard from "@/components/Dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <Dashboard today={businessToday()} />;
}
