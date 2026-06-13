import type { CharacterProfile, Channel, ChannelMessage } from "@/types";
import { generateId } from "@/lib/utils";

export class ChannelManager {
  channels: Channel[] = [];
  messages: ChannelMessage[] = [];

  /** Auto-create channels: 1 public + private channels for each relationship */
  initFromCharacters(characters: CharacterProfile[]): void {
    const charIds = characters.map((c) => c.id);

    // Public channel
    this.channels.push({
      id: "public",
      name: "公共频道",
      type: "public",
      participants: [...charIds],
    });

    // Private channels for existing relationships
    for (const char of characters) {
      for (const rel of char.relationships) {
        if (!charIds.includes(rel.characterId)) continue;
        const pairKey = [char.id, rel.characterId].sort().join("-");
        if (this.channels.some((c) => c.id === `priv-${pairKey}`)) continue;
        this.channels.push({
          id: `priv-${pairKey}`,
          name: `${char.name} ↔ ${rel.characterName}`,
          type: "private",
          participants: [char.id, rel.characterId],
        });
      }
    }
  }

  /** Send a message to a channel — stored for subscribers to retrieve */
  send(fromCharId: string, fromCharName: string, channelId: string, content: { dialogue: string; actions: string; innerThoughts: string }): ChannelMessage {
    const msg: ChannelMessage = {
      id: generateId(),
      fromCharacterId: fromCharId,
      fromCharacterName: fromCharName,
      channelId,
      ...content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    return msg;
  }

  /** Get messages visible to a character (their subscribed channels) */
  getForCharacter(charId: string, since?: number): ChannelMessage[] {
    const subscribedChannels = this.channels
      .filter((c) => c.participants.includes(charId))
      .map((c) => c.id);
    return this.messages.filter(
      (m) => subscribedChannels.includes(m.channelId) && (!since || m.timestamp > since)
    );
  }

  /** Get all messages (for Writer/Director) */
  getAll(since?: number): ChannelMessage[] {
    return since ? this.messages.filter((m) => m.timestamp > since) : [...this.messages];
  }

  /** Get messages for a specific channel */
  getChannelMessages(channelId: string): ChannelMessage[] {
    return this.messages.filter((m) => m.channelId === channelId);
  }

  /** Get fresh messages since last round (for Writer) */
  getNewMessages(lastTimestamp: number): ChannelMessage[] {
    return this.messages.filter((m) => m.timestamp > lastTimestamp);
  }

  /** Get private channels for a specific character pair */
  getPrivateChannel(charA: string, charB: string): Channel | undefined {
    const key = [charA, charB].sort().join("-");
    return this.channels.find((c) => c.id === `priv-${key}`);
  }

  /** List channels a character can see */
  getCharChannels(charId: string): Channel[] {
    return this.channels.filter((c) => c.participants.includes(charId));
  }
}
