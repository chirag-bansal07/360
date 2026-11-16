import type { ReactNode } from 'react';

// The page of one design is the same for every design: its data is loaded by the browser. With no list of ids here the
// page is built the first time an id is opened and then served ready-made, without a trip to the server region.
export function generateStaticParams() { return []; }

export default function Layout({ children }: { children: ReactNode }) { return children; }
