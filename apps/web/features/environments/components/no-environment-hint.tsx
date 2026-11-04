import Link from "next/link";

/** Where to go when something needs an environment and the project has none. */
export function NoEnvironmentHint({
  projectId,
  children = "",
}: {
  projectId: string;
  /** What the environment needs, after "Add an environment first". */
  children?: React.ReactNode;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Add an environment first, on the{" "}
      <Link href={`/projects/${projectId}/environments`} className="text-primary hover:underline">
        Environments
      </Link>{" "}
      page{children}.
    </p>
  );
}
