'use client';
import { useParams } from 'next/navigation';
import ViewerScreen from '@/components/ViewerScreen';

// Shared link: open to anyone who has it, read only.
export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <ViewerScreen share={token} />;
}
