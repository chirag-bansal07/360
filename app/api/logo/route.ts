import { readDb, pictureResponse } from '@/lib/store';
import { guard } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The company logo of the signed-in login, as a picture the browser keeps.
export const GET = guard(async function GET() {
  return pictureResponse((await readDb()).settings.company.logo);
});
