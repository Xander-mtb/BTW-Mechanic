import { MessageFlags } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';

const BUG_REPLY_MODAL_PREFIX = 'help-bug-reply-modal';
const BUG_REPLY_ID = 'help-bug-reply-text';

export default [
    {
        name: BUG_REPLY_MODAL_PREFIX,

        async execute(interaction, client, args) {
            try {
                // Get the reporter ID from the modal custom ID.
                // Expected format:
                // help-bug-reply-modal:123456789012345678

                const parts = interaction.customId.split(':');
                const reporterId = args?.[0] || parts[1];

                if (!reporterId) {
                    throw new Error(
                        'Could not determine the bug reporter ID.'
                    );
                }

                const replyText = interaction.fields
                    .getTextInputValue(BUG_REPLY_ID)
                    ?.trim();

                if (!replyText) {
                    await interaction.reply({
                        content:
                            '❌ You must enter a response before submitting.',
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }

                logger.info(
                    `Sending bug report response to ${reporterId}`
                );

                // Fetch the original reporter.
                const reporter = await client.users.fetch(reporterId);

                if (!reporter) {
                    throw new Error(
                        'Could not find the bug reporter.'
                    );
                }

                // Create the DM embed.
                const responseEmbed = createEmbed({
                    title: '🐛 Bug Report Update',

                    description:
                        'You have received an update regarding the bug you reported to **BTW Mechanic**.',

                    color: 'success',

                    fields: [
                        {
                            name: '📨 Response from the Bot Team',
                            value: replyText,
                            inline: false,
                        },
                    ],
                });

                responseEmbed.setFooter({
                    text: 'BTW Mechanic Bug Reporting System',
                });

                responseEmbed.setTimestamp();

                // Send the response to the reporter.
                await reporter.send({
                    embeds: [responseEmbed],
                });

                // Tell you the reply was successfully sent.
                await interaction.reply({
                    content:
                        '✅ **Reply sent!**\n\n' +
                        `Your response has been sent to <@${reporterId}>.`,
                    flags: MessageFlags.Ephemeral,
                });

                logger.info(
                    `Bug report response successfully sent to ${reporterId}`
                );

            } catch (error) {
                logger.error(
                    'Failed to process bug report reply:',
                    {
                        message: error?.message,
                        code: error?.code,
                        stack: error?.stack,
                    }
                );

                let message =
                    '❌ **Something went wrong while sending the reply.**';

                if (error?.code === 50007) {
                    message =
                        '❌ **I could not DM the reporter.**\n\n' +
                        'They may have DMs disabled or have blocked the bot.';
                }

                try {
                    if (
                        !interaction.replied &&
                        !interaction.deferred
                    ) {
                        await interaction.reply({
                            content: message,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                } catch (replyError) {
                    logger.error(
                        'Failed to send bug reply error message:',
                        replyError
                    );
                }
            }
        },
    },
];
