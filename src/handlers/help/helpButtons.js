import { createEmbed } from '../../utils/embeds.js';
import { createAllCommandsMenu } from './helpSelectMenus.js';
import { createInitialHelpMenu } from '../../commands/Core/help.js';

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const BACK_BUTTON_ID = "help-back-to-main";
const PAGINATION_PREFIX = "help-page";

const BUG_REPORT_BUTTON_ID = "help-bug-report";
const BUG_REPLY_PREFIX = "help-bug-reply";

const BUG_REPORT_MODAL_ID = "help-bug-report-modal";
const BUG_REPLY_MODAL_PREFIX = "help-bug-reply-modal";

const BUG_TITLE_ID = "help-bug-title";
const BUG_DESCRIPTION_ID = "help-bug-description";
const BUG_STEPS_ID = "help-bug-steps";
const BUG_EXPECTED_ID = "help-bug-expected";
const BUG_EXTRA_ID = "help-bug-extra";

const BUG_REPLY_ID = "help-bug-reply-text";

export const helpBackButton = {
    name: BACK_BUTTON_ID,

    async execute(interaction, client) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const { embeds, components } =
                await createInitialHelpMenu(client);

            await interaction.editReply({
                embeds,
                components,
            });
        } catch (error) {
            if (error?.code === 40060 || error?.code === 10062) {
                logger.warn(
                    'Help back button interaction already acknowledged or expired.',
                    {
                        event: 'interaction.help.button.unavailable',
                        errorCode: String(error.code),
                        customId: interaction.customId,
                        interactionId: interaction.id,
                    }
                );

                return;
            }

            throw error;
        }
    },
};

export const helpBugReportButton = {
    name: BUG_REPORT_BUTTON_ID,

    async execute(interaction, client) {
        try {
            const modal = new ModalBuilder()
                .setCustomId(BUG_REPORT_MODAL_ID)
                .setTitle('🐛 Report a Bug');

            const titleInput = new TextInputBuilder()
                .setCustomId(BUG_TITLE_ID)
                .setLabel('What is the bug?')
                .setPlaceholder('Short title describing the bug')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            const descriptionInput = new TextInputBuilder()
                .setCustomId(BUG_DESCRIPTION_ID)
                .setLabel('Describe the bug')
                .setPlaceholder('Explain what is going wrong...')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            const stepsInput = new TextInputBuilder()
                .setCustomId(BUG_STEPS_ID)
                .setLabel('How can we fix it?')
                .setPlaceholder(
                    'Tell us how you think we can fix this...'
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            const expectedInput = new TextInputBuilder()
                .setCustomId(BUG_EXPECTED_ID)
                .setLabel('What should have happened?')
                .setPlaceholder(
                    'Describe what you expected the bot to do...'
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            const extraInput = new TextInputBuilder()
                .setCustomId(BUG_EXTRA_ID)
                .setLabel('Extra information')
                .setPlaceholder(
                    'Screenshots, error messages, or anything else...'
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descriptionInput),
                new ActionRowBuilder().addComponents(stepsInput),
                new ActionRowBuilder().addComponents(expectedInput),
                new ActionRowBuilder().addComponents(extraInput)
            );

            await interaction.showModal(modal);

            const submitted = await interaction.awaitModalSubmit({
                time: 10 * 60 * 1000,

                filter: (modalInteraction) =>
                    modalInteraction.customId === BUG_REPORT_MODAL_ID &&
                    modalInteraction.user.id === interaction.user.id,
            });

            const bugTitle =
                submitted.fields.getTextInputValue(BUG_TITLE_ID);

            const bugDescription =
                submitted.fields.getTextInputValue(BUG_DESCRIPTION_ID);

            const bugSteps =
                submitted.fields.getTextInputValue(BUG_STEPS_ID);

            const bugExpected =
                submitted.fields.getTextInputValue(BUG_EXPECTED_ID);

            const bugExtra =
                submitted.fields.getTextInputValue(BUG_EXTRA_ID) ||
                'None provided';

            await client.application.fetch();

            const owner = client.application.owner;

            if (!owner || !owner.send) {
                throw new Error(
                    'Could not find the bot owner.'
                );
            }

            /*
             * IMPORTANT:
             * Store the reporter ID directly in the button.
             * This means the Reply button always knows exactly
             * which user submitted the report.
             */
            const replyButton = new ButtonBuilder()
                .setCustomId(
                    `${BUG_REPLY_PREFIX}:${interaction.user.id}`
                )
                .setLabel('Reply to Sender')
                .setStyle(ButtonStyle.Primary);

            const replyRow = new ActionRowBuilder().addComponents(
                replyButton
            );

            const bugEmbed = createEmbed({
                title: '🐛 New Bug Report',

                description:
                    'A new bug report has been submitted through the Help Menu.',

                color: 'error',

                fields: [
                    {
                        name: '🐛 Bug',
                        value: bugTitle,
                        inline: false,
                    },
                    {
                        name: '👤 Reported By',
                        value:
                            `${interaction.user.tag} (<@${interaction.user.id}>)\n` +
                            `User ID: \`${interaction.user.id}\``,
                        inline: false,
                    },
                    {
                        name: '🏠 Server',
                        value:
                            interaction.guild
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
                        name: '🔁 How Can We Fix It?',
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
                    },
                ],
            });

            bugEmbed.setFooter({
                text: 'BTW Mechanic Bug Reporting System',
            });

            bugEmbed.setTimestamp();

            await owner.send({
                embeds: [bugEmbed],
                components: [replyRow],
            });

            await submitted.reply({
                content:
                    '✅ **Bug report submitted!**\n\n' +
                    'Thank you for taking the time to report this issue. ' +
                    'The bot owner has received your report.',

                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error(
                'Failed to process help bug report:',
                error
            );

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content:
                            '❌ Something went wrong while submitting your bug report.',
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

export const helpBugReplyButton = {
    name: BUG_REPLY_PREFIX,

    async execute(interaction, client) {
        try {
            /*
             * The custom ID looks like:
             *
             * help-bug-reply:123456789012345678
             *
             * Extract the reporter's Discord ID.
             */
            const parts = interaction.customId.split(':');

            const reporterId = parts[1];

            if (!reporterId) {
                throw new Error(
                    'No reporter ID was found in the bug reply button.'
                );
            }

            logger.info(
                `Opening bug reply form for reporter ${reporterId}`
            );

            const modal = new ModalBuilder()
                .setCustomId(
                    `${BUG_REPLY_MODAL_PREFIX}:${reporterId}`
                )
                .setTitle('📨 Reply to Bug Reporter');

            const replyInput = new TextInputBuilder()
                .setCustomId(BUG_REPLY_ID)
                .setLabel('Your response to the reporter')
                .setPlaceholder(
                    'Explain what you did to resolve or investigate the issue...'
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(2000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(replyInput)
            );

            await interaction.showModal(modal);

        } catch (error) {
            logger.error(
                'Failed to open bug reply modal:',
                error
            );

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content:
                            '❌ Something went wrong while opening the reply form.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } catch (replyError) {
                logger.error(
                    'Failed to send bug reply error response:',
                    replyError
                );
            }
        }
    },
};

/*
 * Modal handler for the "Reply to Sender" form.
 */
export const helpBugReplyModal = {
    name: BUG_REPLY_MODAL_PREFIX,

    async execute(interaction, client) {
        try {
            const parts = interaction.customId.split(':');

            const reporterId = parts[1];

            if (!reporterId) {
                throw new Error(
                    'No reporter ID was found in the reply modal.'
                );
            }

            const replyText =
                interaction.fields.getTextInputValue(
                    BUG_REPLY_ID
                );

            logger.info(
                `Sending bug report response to ${reporterId}`
            );

            const reporter =
                await client.users.fetch(reporterId);

            if (!reporter) {
                throw new Error(
                    'Could not find the bug reporter.'
                );
            }

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

            await reporter.send({
                embeds: [responseEmbed],
            });

            await interaction.reply({
                content:
                    `✅ **Reply sent!**\n\nYour response has been sent to <@${reporterId}>.`,
                flags: MessageFlags.Ephemeral,
            });

            logger.info(
                `Successfully sent bug report response to ${reporterId}`
            );

        } catch (error) {
            logger.error(
                'FAILED TO SEND BUG REPORT RESPONSE:',
                error
            );

            let errorMessage =
                '❌ **Something went wrong while sending the reply.**';

            if (error?.code === 50007) {
                errorMessage +=
                    '\n\nThe user cannot receive DMs from the bot. They may have DMs disabled or the bot may be blocked.';
            }

            if (error?.code === 10013) {
                errorMessage +=
                    '\n\nThe user account could not be found.';
            }

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: errorMessage,
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
};

function getPaginationInfo(components) {
    for (const row of components || []) {
        for (const component of row.components || []) {
            if (
                component.customId ===
                `${PAGINATION_PREFIX}_page`
            ) {
                const label = component.label || '';

                const match = label.match(
                    /Page\s+(\d+)\s+of\s+(\d+)/i
                );

                if (match) {
                    return {
                        currentPage: Number(match[1]),
                        totalPages: Number(match[2]),
                    };
                }
            }
        }
    }

    return {
        currentPage: 1,
        totalPages: 1,
    };
}

export const helpPaginationButton = {
    name: `${PAGINATION_PREFIX}_next`,

    async execute(interaction, client) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const {
                currentPage,
                totalPages,
            } = getPaginationInfo(
                interaction.message?.components
            );

            let nextPage = currentPage;

            switch (interaction.customId) {
                case `${PAGINATION_PREFIX}_first`:
                    nextPage = 1;
                    break;

                case `${PAGINATION_PREFIX}_prev`:
                    nextPage = Math.max(
                        1,
                        currentPage - 1
                    );
                    break;

                case `${PAGINATION_PREFIX}_next`:
                    nextPage = Math.min(
                        totalPages,
                        currentPage + 1
                    );
                    break;

                case `${PAGINATION_PREFIX}_last`:
                    nextPage = totalPages;
                    break;

                default:
                    nextPage = currentPage;
                    break;
            }

            const {
                embeds,
                components,
            } = await createAllCommandsMenu(
                nextPage,
                client
            );

            await interaction.editReply({
                embeds,
                components,
            });

        } catch (error) {
            if (
                error?.code === 40060 ||
                error?.code === 10062
            ) {
                logger.warn(
                    'Help pagination interaction already acknowledged or expired.',
                    {
                        event:
                            'interaction.help.pagination.unavailable',
                        errorCode: String(error.code),
                        customId: interaction.customId,
                        interactionId: interaction.id,
                    }
                );

                return;
            }

            throw error;
        }
    },
};
