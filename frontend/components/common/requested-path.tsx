'use client';

import { usePathname } from 'next/navigation';

export function RequestedPath() {
  const pathname = usePathname();
  return <code className="break-all font-mono text-[#172321]">{pathname}</code>;
}
