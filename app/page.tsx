import { businessToday } from "@/lib/domain";
import Dashboard from "@/components/Dashboard";
import { parseSection } from "@/lib/navigation";
export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <Dashboard today={businessToday()} initialSection={parseSection(params.seccion)} />;
}
