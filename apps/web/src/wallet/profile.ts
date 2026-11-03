import type { ProfileUpdate, ProfileView } from '@elymum/shared';
import { SERVER } from '../config';
import { serverText, t } from '../i18n';

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
    throw new Error(t('api.reach'));
  }
  const data = (await res.json().catch(() => null)) as { profile?: ProfileView; message?: string; error?: string } | ProfileView | null;
  if (!res.ok) {
    const msg = serverText(data && 'message' in data && typeof data.message === 'string' ? data.message : undefined, res.status === 401 ? t('api.expiredVerify') : t('api.profileFailed'));
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (data && 'profile' in data && data.profile) return data.profile;
  return data as ProfileView;
}

async function profileCall(token: string, method: 'POST' | 'DELETE', body?: Blob): Promise<ProfileView> {
  let res: Response;
  try {
    res = await fetch(`${SERVER.http}/api/profile/avatar`, {
      method,
      headers: { ...(body ? { 'Content-Type': body.type } : {}), Authorization: `Bearer ${token}` },
      body,
    });
  } catch {
    throw new Error(t('api.reach'));
  }
  const data = (await res.json().catch(() => null)) as { profile?: ProfileView; message?: string } | null;
  if (!res.ok || !data?.profile) {
    const msg =
      serverText(typeof data?.message === 'string' ? data.message : undefined, res.status === 401 ? t('api.expiredVerify') : res.status === 429 ? t('api.picRate') : t('api.picFailed'));
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data.profile;
}

/** `POST /api/profile/avatar` (the cropped picture, `image/webp` or `image/png`): the profile with its new `avatar`. */
export function uploadAvatar(token: string, picture: Blob): Promise<ProfileView> {
  return profileCall(token, 'POST', picture);
}

/** `DELETE /api/profile/avatar`: the profile without a picture. */
export function deleteAvatar(token: string): Promise<ProfileView> {
  return profileCall(token, 'DELETE');
}
