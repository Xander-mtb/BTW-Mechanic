import { logger } from '../../utils/logger.js';

const DB_KEY = 'global:ban-sync:active';

function getMainGuildId() {
    return process.env.BAN_MAIN_GUILD_ID;
}

function getAppealGuildId() {
    return process.env.BAN_APPEAL_GUILD_ID;
}

function getAcceptedRoleId() {
    return process.env.BAN_APPEAL_ACCEPTED_ROLE_ID;
}

/**
 * Get all active cross-server bans.
 */
export async function getTrackedBans(client) {
    try {
        if (!client?.db) {
            logger.warn('Ban sync: database is not available.');
            return {};
        }

        const bans = await client.db.get(DB_KEY, {});

        if (!bans || typeof bans !== 'object' || Array.isArray(bans)) {
            return {};
        }

        return bans;
    } catch (error) {
        logger.error('Ban sync: failed to get tracked bans:', error);
        return {};
    }
}

/**
 * Save/update a tracked ban.
 */
export async function trackBan(client, {
    userId,
    username = null,
    reason = 'No reason provided',
    moderatorId = null,
    guildId = null,
}) {
    try {
        if (!client?.db || !userId) {
            return false;
        }

        const bans = await getTrackedBans(client);

        bans[userId] = {
            userId,
            username,
            reason,
            moderatorId,
            guildId,
            bannedAt: new Date().toISOString(),
            active: true,
        };

        await client.db.set(DB_KEY, bans);

        logger.info(
            `Ban sync: tracked ${userId} from guild ${guildId || 'unknown'}`
        );

        return true;
    } catch (error) {
        logger.error(`Ban sync: failed to track ${userId}:`, error);
        return false;
    }
}

/**
 * Remove a user from the tracked-ban database.
 */
export async function removeTrackedBan(client, userId) {
    try {
        if (!client?.db || !userId) {
            return false;
        }

        const bans = await getTrackedBans(client);

        if (!bans[userId]) {
            return true;
        }

        delete bans[userId];

        await client.db.set(DB_KEY, bans);

        logger.info(`Ban sync: removed ${userId} from tracked bans`);

        return true;
    } catch (error) {
        logger.error(`Ban sync: failed to remove ${userId}:`, error);
        return false;
    }
}

/**
 * Check whether a user has the accepted appeal role.
 */
export async function hasAcceptedAppeal(client, userId) {
    try {
        const appealGuildId = getAppealGuildId();
        const acceptedRoleId = getAcceptedRoleId();

        if (!appealGuildId || !acceptedRoleId) {
            return false;
        }

        const appealGuild = await client.guilds
            .fetch(appealGuildId)
            .catch(() => null);

        if (!appealGuild) {
            logger.warn(
                `Ban sync: bot is not in appeal guild ${appealGuildId}`
            );
            return false;
        }

        const member = await appealGuild.members
            .fetch(userId)
            .catch(() => null);

        if (!member) {
            return false;
        }

        return member.roles.cache.has(acceptedRoleId);
    } catch (error) {
        logger.error(
            `Ban sync: failed checking appeal status for ${userId}:`,
            error
        );

        return false;
    }
}

/**
 * Unban a user from the main server.
 */
export async function unbanFromMainServer(client, userId, reason) {
    try {
        const mainGuildId = getMainGuildId();

        if (!mainGuildId) {
            logger.warn('Ban sync: BAN_MAIN_GUILD_ID is not configured.');
            return false;
        }

        const mainGuild = await client.guilds
            .fetch(mainGuildId)
            .catch(() => null);

        if (!mainGuild) {
            logger.warn(
                `Ban sync: bot is not in main guild ${mainGuildId}`
            );
            return false;
        }

        const ban = await mainGuild.bans
            .fetch(userId)
            .catch(() => null);

        if (!ban) {
            return true;
        }

        await mainGuild.members.unban(
            userId,
            reason || 'Appeal accepted'
        );

        logger.info(
            `Ban sync: unbanned ${userId} from main server`
        );

        return true;
    } catch (error) {
        logger.error(
            `Ban sync: failed to unban ${userId} from main server:`,
            error
        );

        return false;
    }
}

/**
 * Check one tracked user.
 *
 * If they have an accepted appeal:
 *   - unban them
 *   - remove their database record
 *
 * Otherwise:
 *   - make sure they remain banned
 */
export async function syncTrackedUser(client, userId, banData) {
    try {
        const mainGuildId = getMainGuildId();

        if (!mainGuildId) {
            logger.warn('Ban sync: BAN_MAIN_GUILD_ID is not configured.');
            return {
                success: false,
                reason: 'missing_main_guild',
            };
        }

        const appealAccepted = await hasAcceptedAppeal(client, userId);

        if (appealAccepted) {
            await unbanFromMainServer(
                client,
                userId,
                'Appeal accepted'
            );

            await removeTrackedBan(client, userId);

            logger.info(
                `Ban sync: appeal accepted for ${userId}; removed active ban`
            );

            return {
                success: true,
                action: 'appeal_accepted',
            };
        }

        const mainGuild = await client.guilds
            .fetch(mainGuildId)
            .catch(() => null);

        if (!mainGuild) {
            return {
                success: false,
                reason: 'main_guild_not_found',
            };
        }

        const currentBan = await mainGuild.bans
            .fetch(userId)
            .catch(() => null);

        if (!currentBan) {
            try {
                await mainGuild.members.ban(userId, {
                    reason:
                        `Ban sync: ${banData?.reason || 'Tracked ban'}`
                });

                logger.info(
                    `Ban sync: re-banned ${userId} in main server`
                );

                return {
                    success: true,
                    action: 'reban',
                };
            } catch (error) {
                logger.error(
                    `Ban sync: failed to re-ban ${userId}:`,
                    error
                );

                return {
                    success: false,
                    reason: 'reban_failed',
                };
            }
        }

        return {
            success: true,
            action: 'already_banned',
        };
    } catch (error) {
        logger.error(
            `Ban sync: failed syncing ${userId}:`,
            error
        );

        return {
            success: false,
            reason: 'error',
        };
    }
}

/**
 * Refresh every tracked ban.
 */
export async function refreshBanSync(client) {
    try {
        const bans = await getTrackedBans(client);

        const userIds = Object.keys(bans);

        let checked = 0;
        let rebanned = 0;
        let unbanned = 0;
        let alreadyBanned = 0;
        let errors = 0;

        for (const userId of userIds) {
            const result = await syncTrackedUser(
                client,
                userId,
                bans[userId]
            );

            checked++;

            if (result.action === 'reban') {
                rebanned++;
            } else if (result.action === 'appeal_accepted') {
                unbanned++;
            } else if (result.action === 'already_banned') {
                alreadyBanned++;
            } else if (!result.success) {
                errors++;
            }
        }

        const summary = {
            checked,
            rebanned,
            unbanned,
            alreadyBanned,
            errors,
        };

        logger.info(
            `Ban sync refresh complete: ${JSON.stringify(summary)}`
        );

        return summary;
    } catch (error) {
        logger.error('Ban sync refresh failed:', error);

        return {
            checked: 0,
            rebanned: 0,
            unbanned: 0,
            alreadyBanned: 0,
            errors: 1,
        };
    }
}

/**
 * Called when somebody joins the main server.
 */
export async function enforceBanOnJoin(member) {
    try {
        const mainGuildId = getMainGuildId();

        if (!mainGuildId || member.guild.id !== mainGuildId) {
            return false;
        }

        const bans = await getTrackedBans(member.client);
        const banData = bans[member.id];

        if (!banData) {
            return false;
        }

        const result = await syncTrackedUser(
            member.client,
            member.id,
            banData
        );

        return result.action === 'reban';
    } catch (error) {
        logger.error(
            `Ban sync: failed checking joining user ${member.id}:`,
            error
        );

        return false;
    }
}

/**
 * Called when the accepted appeal role is added.
 */
export async function handleAppealRoleUpdate(member) {
    try {
        const appealGuildId = getAppealGuildId();
        const acceptedRoleId = getAcceptedRoleId();

        if (
            !appealGuildId ||
            !acceptedRoleId ||
            member.guild.id !== appealGuildId
        ) {
            return false;
        }

        if (!member.roles.cache.has(acceptedRoleId)) {
            return false;
        }

        const bans = await getTrackedBans(member.client);

        if (!bans[member.id]) {
            return false;
        }

        await unbanFromMainServer(
            member.client,
            member.id,
            'Appeal accepted'
        );

        await removeTrackedBan(
            member.client,
            member.id
        );

        logger.info(
            `Ban sync: ${member.user.tag} had their appeal accepted`
        );

        return true;
    } catch (error) {
        logger.error(
            `Ban sync: failed handling appeal role for ${member.id}:`,
            error
        );

        return false;
    }
}
