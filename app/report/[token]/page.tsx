'use client';
import { useParams } from 'next/navigation';
import ReportScreen from '@/components/ReportScreen';

// Shared link: open to anyone who has it, read only.
export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <ReportScreen share={token} />;
}
