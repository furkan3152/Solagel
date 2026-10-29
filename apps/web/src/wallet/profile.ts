import type { ProfileUpdate, ProfileView } from '@elymum/shared';
import { SERVER } from '../config';

/** `PUT /api/profile {name, skin}` with the session token. Throws an Error with the server's message. */
export async function saveProfile(token: string, body: ProfileUpdate): Promise<ProfileView> {
  let res: Response;
  try {
    res = await fetch(`${SERVER.http}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the server right now.');
  }
  const data = (await res.json().catch(() => null)) as { profile?: ProfileView; message?: string; error?: string } | ProfileView | null;
  if (!res.ok) {
    const msg = data && 'message' in data && typeof data.message === 'string' ? data.message : res.status === 401 ? 'Your sign-in expired. Verify your wallet again.' : 'The profile was not saved.';
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (data && 'profile' in data && data.profile) return data.profile;
  return data as ProfileView;
}
