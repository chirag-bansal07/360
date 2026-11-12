'use client';
import { useParams } from 'next/navigation';
import ViewerScreen from '@/components/ViewerScreen';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ViewerScreen id={id} />;
}
