const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } = require('@discordjs/voice');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();
const { generateDependencyReport } = require('@discordjs/voice');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ===== CONFIGURATION FROM .env =====
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
// ===================================

const player = createAudioPlayer();
let connection = null;

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Watching for messages from user ${TARGET_USER_ID} in channel ${TARGET_CHANNEL_ID}`);
});

async function generateTTS(text) {
    try {
        const response = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
            },
            data: {
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            },
            responseType: 'stream',
        });

        return response.data;
    } catch (error) {
        console.error('ElevenLabs API Error:', error.response?.data || error.message);
        throw error;
    }
}


client.on('messageCreate', async (message) => {
    // Check if the message is from the target user in the target channel
    if (message.author.id !== TARGET_USER_ID) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;
    if (message.author.bot) return;
    if (!message.content || message.content.trim().length === 0) return;
    if (message.content == "!leave" & !connection) {connection.destroy(); connection = null; return;}

    console.log(`Target user sent a message: "${message.content}"`);

    // Find the user's voice channel
    const member = message.guild.members.cache.get(TARGET_USER_ID);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
        console.log('User is not in a voice channel');
        return;
    }

    // Join the voice channel if not already connected
    if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            console.log(`Connected to voice channel: ${voiceChannel.name}`);
        } catch (error) {
            console.error('Failed to connect to voice channel:', error);
            connection.destroy();
            return;
        }

        connection.subscribe(player);
    }
    
    try {
        // React to show processing
        await message.react('🔄');

        // Generate TTS from ElevenLabs
        console.log('Generating TTS from ElevenLabs...');
        const audioStream = await generateTTS(message.content);

        // Create audio resource from stream
        const resource = createAudioResource(audioStream, {
            inputType: StreamType.Arbitrary,
        });

        player.play(resource);

        // Update reaction to show playing
        await message.reactions.removeAll();
        await message.react('🔊');

        console.log('Now playing TTS audio');

        // When finished playing
        player.once(AudioPlayerStatus.Idle, async () => {
            console.log('Finished playing TTS');
            await message.reactions.removeAll();
            await message.react('✅');

            // Uncomment to leave after playing
            // connection.destroy();
            // connection = null;
        });

    } catch (error) {
        console.error('Error generating or playing TTS:', error);
        await message.reactions.removeAll();
        await message.react('❌');
        await message.reply('Failed to generate TTS. Please check the bot logs.');
    }
});

// Handle player errors
player.on('error', error => {
  console.error('Audio player error:', error);
});

// Handle connection errors
player.on(AudioPlayerStatus.Idle, () => {
  // Cleanup if needed
});

client.login(TOKEN);