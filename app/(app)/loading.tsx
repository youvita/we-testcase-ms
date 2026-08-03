import { Skeleton } from "@/components/ui/skeleton";

/** Shared skeleton for every page under the app shell. */
export default function AppLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-48" />

      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-lg" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
      </div>
    </div>
  );
}
