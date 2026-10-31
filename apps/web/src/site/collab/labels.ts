import type { CollabRole, CollabType } from '@elymum/shared';

export const TYPE_LABEL: Record<CollabType, string> = { dao: 'DAO', guild: 'Guild', alpha: 'Alpha group', nft: 'NFT project', other: 'Other' };
export const ROLE_LABEL: Record<CollabRole, string> = { founder: 'Founder', community_manager: 'Community manager', moderator: 'Moderator', other: 'Other' };
