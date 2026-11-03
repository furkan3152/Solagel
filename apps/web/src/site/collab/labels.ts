import type { CollabRole, CollabType } from '@elymum/shared';
import { t } from '../../i18n';

export const TYPE_LABEL: Record<CollabType, string> = { dao: 'DAO', guild: 'Guild', alpha: 'Alpha group', nft: 'NFT project', other: 'Other' };
export const ROLE_LABEL: Record<CollabRole, string> = { founder: 'Founder', community_manager: 'Community manager', moderator: 'Moderator', other: 'Other' };

/** The same labels in the reader's language (the admin panel keeps the English tables above). */
export const typeLabel = (k: CollabType): string => t(`cb.type.${k}` as 'cb.type.dao');
export const roleLabel = (k: CollabRole): string => t(`cb.role.${k}` as 'cb.role.founder');
