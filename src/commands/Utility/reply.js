import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('reply')
        .setDescription('Reply to a user via the bot DMs')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) // Restricts visibility to Staff
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('The Discord ID of the user you want to reply to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message you want to send to the user')
                .setRequired(true)
        ),

    async execute(interaction) {
        const staffChannelId = process.env.STAFF_CHANNEL_ID;
        
        if (interaction.channelId !== staffChannelId) {
            return interaction.reply({ 
                content: '❌ This command can only be used in the designated staff channel.', 
                ephemeral: true 
            });
        }

        const targetId = interaction.options.getString('user_id');
        const replyText = interaction.options.getString('message');

        await interaction.deferReply();

        try {
            const targetUser = await interaction.client.users.fetch(targetId);
            await targetUser.send(`💬 **Staff Reply:** ${replyText}`);
            await interaction.editReply(`✅ Message successfully sent to **${targetUser.tag}**.`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Failed to send DM. The user may have their DMs closed, or the provided ID is invalid.');
        }
    },
};
