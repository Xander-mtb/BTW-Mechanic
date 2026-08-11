import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';

import { logger } from '../../../utils/logger.js';

const BUG_REPORT_MODAL_ID = 'help-bug-report-modal';

const BUG_TITLE_ID = 'help-bug-title';
const BUG_DESCRIPTION_ID = 'help-bug-description';
const BUG_STEPS_ID = 'help-bug-steps';
const BUG_EXPECTED_ID = 'help-bug-expected';
const BUG_EXTRA_ID = 'help-bug-extra';

const BUG_REPLY_BUTTON_PREFIX = 'help-bug-reply';

export default {
    name: BUG_REPORT_MODAL_ID,

    async execute(interaction, client) {
        try {
            const bugTitle =
                interaction.fields.getTextInputValue(BUG_TITLE_ID);

            const bugDescription =
                interaction.fields.getTextInputValue(BUG_DESCRIPTION_ID);

            const bugSteps =
                interaction.fields.getTextInputValue(BUG_STEPS_ID);

            const bugExpected =
                interaction.fields.getTextInputValue(BUG_EXPECTED_ID);

            const bugExtra =
                interaction.fields.getTextInputValue(BUG_EXTRA_ID) ||
                'None provided';

            /*
             * Find the bot owner.
             */
            await client.application.fetch();

            const owner = client.application.owner;

            if (!owner) {
                throw new Error(
                    'Could not determine the bot owner.'
                );
            }

            /*
             * Build the bug report embed.
             */
            const bugEmbed = new EmbedBuilder()
                .setTitle('🐛 New Bug Report')
                .setDescription(
                    'A new bug report has been submitted through the BTW Mechanic Help Menu.'
                )
                .addFields(
                    {
                        name: '🐛 Bug',
                        value: bugTitle,
                        inline: false,
                    },
                    {
                        name: '👤 Reported By',
                        value:
                            `${interaction.user.tag}\n` +
                            `User ID: \`${interaction.user.id}\``,
                        inline: false,
                    },
                    {
                        name: '🏠 Server',
                        value: interaction.guild
                            ? `${interaction.guild.name}\nID: \`${interaction.guild.id}\``
                            : 'Direct Message',
                        inline: false,
                    },
                    {
                        name: '📝 Description',
                        value: bugDescription,
                        inline: false,
                    },
                    {
                        name: '🔁 How to Reproduce',
                        value: bugSteps,
                        inline: false,
                    },
                    {
                        name: '✅ Expected Behaviour',
                        value: bugExpected,
                        inline: false,
                    },
                    {
                        name: '📎 Extra Information',
                        value: bugExtra,
                        inline: false,
                    }
                )
                .setFooter({
                    text: 'BTW Mechanic Bug Reporting System',
                })
                .setTimestamp();

            /*
             * This button stores the reporter's Discord ID
             * in the custom ID.
             *
             * Example:
             * help-bug-reply:123456789012345678
             */
            const replyButton = new ButtonBuilder()
                .setCustomId(
                    `${BUG_REPLY_BUTTON_PREFIX}:${interaction.user.id}`
                )
                .setLabel('Reply to Sender')
                .setStyle(ButtonStyle.Primary);

            const replyRow =
                new ActionRowBuilder().addComponents(
                    replyButton
                );

            /*
             * Send the bug report to the bot owner.
             */
            await owner.send({
                embeds: [bugEmbed],
                components: [replyRow],
            });

            /*
             * Tell the person who submitted the report
             * that it was successfully received.
             */
            await interaction.reply({
                content:
                    '✅ **Bug report submitted!**\n\n' +
                    'Your report has been sent to the BTW Mechanic team. ' +
                    'Thank you for helping us improve the bot!',
                flags: MessageFlags.Ephemeral,
            });

            logger.info(
                `Bug report submitted by ${interaction.user.tag} (${interaction.user.id})`
            );
        } catch (error) {
            logger.error(
                'Failed to process bug report:',
                {
                    message: error?.message,
                    code: error?.code,
                    stack: error?.stack,
                }
            );

            /*
             * Discord error 50007 means the bot could not
             * send a DM. This shouldn't normally happen here
             * because we're DMing the bot owner.
             */
            let message =
                '❌ **Something went wrong while submitting your bug report.**';

            if (error?.code === 50007) {
                message =
                    '❌ **I could not send the bug report to the bot owner.**';
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
                    'Failed to send bug report error response:',
                    replyError
                );
            }
        }
    },
};
