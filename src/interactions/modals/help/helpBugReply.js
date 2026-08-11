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
                /*
                 * The modal custom ID looks like:
                 *
                 * help-bug-reply-modal:123456789012345678
                 *
                 * The interaction system passes the part after
                 * the colon in args.
                 */

                let reporterId = args?.[0];

                /*
                 * Fallback: get the ID directly from customId
                 * if args wasn't provided.
                 */
                if (!reporterId) {
                    const parts =
                        interaction.customId.split(':');

                    reporterId = parts[1];
                }

                if (!reporterId) {
                    throw new Error(
                        'Could not determine the bug reporter ID.'
                    );
                }

                const replyText =
                    interaction.fields
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

                /*
                 * Fetch the user from Discord.
                 */
                const reporter =
                    await client.users.fetch(reporterId);

                if (!reporter) {
                    throw new Error(
                        'Could not find the bug reporter.'
                    );
                }

                /*
                 * Build the DM that the reporter receives.
                 */
                const responseEmbed = createEmbed({
                    title: '🐛 Bug Report Update',

                    description:
                        'You have received an update regarding the bug you reported to BTW Mechanic.',

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

                /*
                 * Send the response to the reporter.
                 */
                await reporter.send({
                    embeds: [responseEmbed],
                });

                /*
                 * Tell you that it was successfully sent.
                 */
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
