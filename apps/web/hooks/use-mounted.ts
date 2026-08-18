import { useEffect, useState } from "react";

/** False during SSR / first paint so Recharts can wait for a real layout box. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
