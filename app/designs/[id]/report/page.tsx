'use client';
import { useParams } from 'next/navigation';
import ReportScreen from '@/components/ReportScreen';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ReportScreen id={id} />;
}
