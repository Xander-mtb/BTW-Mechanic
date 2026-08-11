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

const BACK_BUTTON_ID = 'help-back-to-main';
const PAGINATION_PREFIX = 'help-page';

const BUG_REPORT_BUTTON_ID = 'help-bug-report';
const BUG_REPORT_MODAL_ID = 'help-bug-report-modal';

const BUG_REPLY_BUTTON_PREFIX = 'help-bug-reply';
const BUG_REPLY_MODAL_PREFIX = 'help-bug-reply-modal';

const BUG_TITLE_ID = 'help-bug-title';
const BUG_DESCRIPTION_ID = 'help-bug-description';
const BUG_STEPS_ID = 'help-bug-steps';
const BUG_EXPECTED_ID = 'help-bug-expected';
const BUG_EXTRA_ID = 'help-bug-extra';

const BUG_REPLY_ID = 'help-bug-reply-text';


// ===============================
// BACK TO HELP MENU
// ===============================

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


// ===============================
// REPORT BUG BUTTON
// ===============================

export const helpBugReportButton = {
    name: BUG_REPORT_BUTTON_ID,

    async execute(interaction) {
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
                .setLabel('How can we reproduce it?')
                .setPlaceholder(
                    'Tell us the steps needed to reproduce the bug...'
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

        } catch (error) {
            logger.error(
                'Failed to open bug report form:',
                error
            );

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content:
                        '❌ Something went wrong while opening the bug report form.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        }
    },
};


// ===============================
// REPLY TO SENDER BUTTON
// ===============================

export const helpBugReplyButton = {
    name: BUG_REPLY_BUTTON_PREFIX,

    async execute(interaction) {
        try {
            /*
             * The button custom ID is:
             *
             * help-bug-reply:USER_ID
             */

            const parts = interaction.customId.split(':');
            const reporterId = parts[1];

            if (!reporterId) {
                throw new Error(
                    'Could not determine the bug reporter ID.'
                );
            }

            const modal = new ModalBuilder()
                .setCustomId(
                    `${BUG_REPLY_MODAL_PREFIX}:${reporterId}`
                )
                .setTitle('Reply to Bug Reporter');

            const replyInput = new TextInputBuilder()
                .setCustomId(BUG_REPLY_ID)
                .setLabel('Your response')
                .setPlaceholder(
                    'Tell the reporter what you have done to resolve the issue...'
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
                'Failed to open bug reply form:',
                error
            );

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content:
                        '❌ Something went wrong while opening the reply form.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        }
    },
};


// ===============================
// PAGINATION
// ===============================

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
