import {
    SlashCommandBuilder,
    PermissionFlagsBits,
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { refreshBanSync } from '../../services/moderation/banSyncService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('banrefresh')
        .setDescription('Refresh the cross-server ban list')
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers
        ),

    category: 'moderation',

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const result = await refreshBanSync(client);

        await InteractionHelper.safeEditReply(interaction, {
            content:
                `🔄 **Ban list refreshed.**\n\n` +
                `**Checked:** ${result.checked}\n` +
                `**Re-banned:** ${result.rebanned}\n` +
                `**Unbanned (appeals):** ${result.unbanned}\n` +
                `**Already banned:** ${result.alreadyBanned}\n` +
                `**Errors:** ${result.errors}`,
        });
    },
};
