async updateAllCounters() {
  if (!this.db) {
    logger.warn('Database not available for counter updates');
    return;
  }

  for (const [guildId, guild] of this.guilds.cache) {
    try {
      const counters = await getServerCounters(this, guildId);
      const validCounters = [];
      const orphanedCounters = [];

      for (const counter of counters) {
        if (
          counter &&
          counter.type &&
          counter.channelId &&
          counter.enabled !== false
        ) {
          const channel = guild.channels.cache.get(counter.channelId);

          if (channel) {
            validCounters.push(counter);
            await updateCounter(this, guild, counter);
          } else {
            orphanedCounters.push(counter);

            logger.info(
              `Removing orphaned counter ${counter.id} ` +
              `(type: ${counter.type}, deleted channel: ${counter.channelId}) ` +
              `from guild ${guildId}`
            );
          }
        }
      }

      if (orphanedCounters.length > 0) {
        await saveServerCounters(
          this,
          guildId,
          validCounters
        );

        logger.info(
          `Cleaned up ${orphanedCounters.length} orphaned counter(s) ` +
          `from guild ${guildId} during scheduled update`
        );
      }

    } catch (error) {
      logger.error(
        `Error updating counters for guild ${guildId}:`,
        error
      );
    }
  }
}
