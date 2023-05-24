const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { Client, Intents, MessageEmbed, MessageActionRow, MessageSelectMenu } = require('discord.js');
const ytdl = require('ytdl-core');
const search = require('youtube-search');
const fetch = require('node-fetch');
const lyricsFinder = require('lyrics-finder');

const keepAlive = require('./alive.js');
keepAlive();


const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES] });

const audioPlayer = createAudioPlayer();
const queue = [];

let isPlaying = false;
let loopQueue = false;
let loopSong = false;

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.application.commands.create({
    name: 'play',
    description: 'Plays the song',
    options: [
      {
        name: 'query',
        description: 'The search query',
        type: 'STRING',
        required: true,
      },
    ],
  });
  
client.application.commands.create({
    name: 'skip',
    description: 'Skips the song',
  });

client.application.commands.create({
    name: 'resume',
    description: 'Resumes the song',
  });
  
client.application.commands.create({
    name: 'pause',
    description: 'Pauses the song',
  });

client.application.commands.create({
    name: 'queue',
    description: 'Shows the queue',
  }); 
  
client.application.commands.create({
    name: 'remove',
    description: 'Remove a specific song from the queue',
    options: [
      {
        name: 'index',
        description: 'The index of the song to remove',
        type: 'INTEGER',
        required: true,
      },
    ],
  });
  
client.application.commands.create({
    name: 'skipto',
    description: 'Skip to a specific song in the queue',
    options: [
      {
        name: 'index',
        description: 'The index of the song to skip to',
        type: 'INTEGER',
        required: true,
      },
    ],
  });

  client.application.commands.create({
    name: 'lyrics',
    description: 'Get lyrics for the current song',
  });

  client.application.commands.create({
    name: 'search',
    description: 'Searches for a song and plays the selected result',
    options: [
      {
        name: 'query',
        description: 'The search query',
        type: 'STRING',
        required: true,
      },
    ],
  });
});
// Track if a song is currently being played


client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'play') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.reply('You must be in a voice channel to use this command.');

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return interaction.reply('I don\'t have permission to join or speak in your voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator
    });

    connection.on('error', (error) => {
      console.error(error);
    });

    try {
      const searchQuery = options.getString('query');

      const searchOptions = {
        maxResults: 1,
        key: process.env.API_KEY, 
        type: 'video'
      };

      search(searchQuery, searchOptions, async (err, results) => {
        if (err) {
          console.error(err);
          return interaction.reply('An error occurred while searching for the video.');
        }

        if (results.length === 0) {
          return interaction.reply('No videos found for the search query.');
        }

        const videoUrl = results[0].link;
        const videoTitle = results[0].title;

        const stream = ytdl(videoUrl, {
            filter: 'audioonly',
            fmt: 'mp3',
            highWaterMark: 1 << 62,
            liveBuffer: 1 << 62,
            dlChunkSize: 0,
            bitrate: 128,
            quality: 'lowestaudio'
          });
          
        const audioResource = createAudioResource(stream);
        queue.push({ resource: audioResource, title: videoTitle });

        await interaction.reply(`Added to queue: ${videoTitle}`);

        if (!isPlaying) {
          playNextInQueue(connection, interaction);
        }
      });

    } catch (error) {
      console.error(error);
    }
  } else if (commandName === 'search') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.reply('You must be in a voice channel to use this command.');

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return interaction.reply('I don\'t have permission to join or speak in your voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator
    });

    connection.on('error', (error) => {
      console.error(error);
    });

    try {
      const searchQuery = options.getString('query');

      const searchOptions = {
        maxResults: 10, // Fetch 10 results
        key: process.env.API_KEY, 
        type: 'video'
      };

      search(searchQuery, searchOptions, async (err, results) => {
        if (err) {
          console.error(err);
          return interaction.reply('An error occurred while searching for the video.');
        }

        if (results.length === 0) {
          return interaction.reply('No videos found for the search query.');
        }

        const dropdownOptions = results.map((result, index) => ({
          label: result.title,
          value: String(index + 1)
        }));

        const selectMenu = new MessageSelectMenu()
          .setCustomId('song_selection')
          .setPlaceholder('Select a song')
          .addOptions(dropdownOptions);

        const row = new MessageActionRow().addComponents(selectMenu);

        interaction.reply({
          content: 'Search results:',
          components: [row]
        });

        const filter = (interaction) => interaction.customId === 'song_selection' && interaction.user.id === interaction.member.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async (interaction) => {
          const selection = parseInt(interaction.values[0]) - 1;

          if (selection >= 0 && selection < results.length) {
            const videoUrl = results[selection].link;
            const videoTitle = results[selection].title;

            const stream = ytdl(videoUrl, {
              filter: 'audioonly',
              fmt: 'mp3',
              highWaterMark: 1 << 25,
              quality: 'lowestaudio'
            });

            const audioResource = createAudioResource(stream);
            queue.push({ resource: audioResource, title: videoTitle });

            await interaction.reply(`Added to queue: ${videoTitle}`);

            if (!isPlaying) {
              isPlaying = true;
              playNextInQueue(connection, interaction);
            }
          }

          collector.stop();
        });

        collector.on('end', () => {
          if (!interaction.replied) {
            interaction.followUp('Song selection expired.');
          }
        });
      });
    } catch (error) {
      console.error(error);
      interaction.reply('An error occurred while processing the command.');
    }
  } else if (commandName === 'skip') {
    if (queue.length > 0) {
      audioPlayer.stop();
      interaction.reply('Skipped the current song.');
    } else {
      interaction.reply('There are no videos in the queue to skip.');
    }
  } else if (commandName === 'queue') {
    if (queue.length > 0) {
      const queueList = queue.map((item, index) => `${index + 1}. ${item.title}`).join('\n');
      interaction.reply(`Current queue:\n${queueList}`);
    } else {
      interaction.reply('The queue is currently empty.');
    }
  } else if (commandName === 'pause') {
    if (isPlaying) {
      audioPlayer.pause();
      interaction.reply('Playback paused.');
    } else {
      interaction.reply('There is no song currently playing.');
    }
  } else if (commandName === 'resume') {
    if (audioPlayer.state.status === AudioPlayerStatus.Paused) {
      audioPlayer.unpause();
      interaction.reply('Playback resumed.');
    } else {
      interaction.reply('There is no paused song to resume.');
    }
  }   else if (commandName === 'remove') {
    const index = options.getInteger('index');
    if (isNaN(index) || index < 1 || index > queue.length) {
      return interaction.reply('Invalid song index.');
    }
    const removedSong = queue.splice(index - 1, 1)[0];
    interaction.reply(`Removed song from queue: ${removedSong.title}`);
  } else if (commandName === 'skipto') {
    const index = options.getInteger('index');
    if (isNaN(index) || index < 1 || index > queue.length) {
      return interaction.reply('Invalid song index.');
    }
    const connection = joinVoiceChannel({
      channelId: interaction.member.voice.channelId,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator
    });
    audioPlayer.stop();
    queue.splice(0, index - 1);
    playNextInQueue(connection, interaction); // Pass the connection variable
    interaction.reply(`Skipping to song ${index} in the queue.`);
  } else if (commandName === 'lyrics') {
    const currentSong = queue[0];
    if (!currentSong) {
      return interaction.reply('There is no song currently playing.');
    }

    const { title } = currentSong;

    try {
      const lyrics = await lyricsFinder(title);

      if (!lyrics) {
        return interaction.reply(`Lyrics not found for the song: ${title}`);
      }

      const embed = new MessageEmbed()
        .setTitle(`Lyrics for: ${title}`)
        .setDescription(lyrics)
        .setColor('#F8F8F8');

      interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.reply('An error occurred while fetching the lyrics.');
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!play')) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('You must be in a voice channel to use this command.');

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return message.reply('I don\'t have permission to join or speak in your voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator
    });

    connection.on('error', (error) => {
      console.error(error);
    });

    try {
      // Get the search query from the message content
      const searchQuery = message.content.slice(6).trim();

      // Search for videos on YouTube based on the search query
      const searchOptions = {
        maxResults: 1,
        key: process.env.API_KEY, 
        type: 'video'
      };

      search(searchQuery, searchOptions, async (err, results) => {
        if (err) {
          console.error(err);
          return message.reply('An error occurred while searching for the video.');
        }

        if (results.length === 0) {
          return message.reply('No videos found for the search query.');
        }

        const videoUrl = results[0].link;
        const videoTitle = results[0].title;

        // Fetch the audio stream from YouTube
        const stream = ytdl(videoUrl, {
            filter: 'audioonly',
            fmt: 'mp3',
            highWaterMark: 1 << 62,
            liveBuffer: 1 << 62,
            dlChunkSize: 0,
            bitrate: 128,
            quality: 'lowestaudio'
          });
          

        // Create an audio resource from the stream
        const audioResource = createAudioResource(stream);

        // Add the audio resource and video title to the queue
        queue.push({ resource: audioResource, title: videoTitle });

        // Send a message to the channel with the video title
        message.channel.send(`Added to queue: ${videoTitle}`);

        // If no song is currently playing, start playing the next song in the queue
        if (!isPlaying) {
          playNextInQueue(connection, message);
        }
      });

    } catch (error) {
      console.error(error);
    }
  } else if (message.content.startsWith('!search')) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('You must be in a voice channel to use this command.');

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return message.reply('I don\'t have permission to join or speak in your voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator
    });

    connection.on('error', (error) => {
      console.error(error);
    });

    try {
      const searchQuery = message.content.slice(8).trim();

      const searchOptions = {
        maxResults: 10, // Fetch 10 results
        key: process.env.API_KEY, 
        type: 'video'
      };

      search(searchQuery, searchOptions, async (err, results) => {
        if (err) {
          console.error(err);
          return message.reply('An error occurred while searching for the video.');
        }

        if (results.length === 0) {
          return message.reply('No videos found for the search query.');
        }

        const dropdownOptions = results.map((result, index) => ({
          label: result.title,
          value: String(index + 1)
        }));

        const selectMenu = new MessageSelectMenu()
          .setCustomId('song_selection')
          .setPlaceholder('Select a song')
          .addOptions(dropdownOptions);

        const row = new MessageActionRow().addComponents(selectMenu);

        const reply = await message.reply({
          content: 'Search results:',
          components: [row]
        });

        const filter = (interaction) => interaction.customId === 'song_selection' && interaction.user.id === message.author.id;
        const collector = reply.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async (interaction) => {
          const selection = parseInt(interaction.values[0]) - 1;

          if (selection >= 0 && selection < results.length) {
            const videoUrl = results[selection].link;
            const videoTitle = results[selection].title;

            const stream = ytdl(videoUrl, {
              filter: 'audioonly',
              fmt: 'mp3',
              highWaterMark: 1 << 25,
              quality: 'lowestaudio'
            });

            const audioResource = createAudioResource(stream);
            queue.push({ resource: audioResource, title: videoTitle });

            await interaction.reply(`Added to queue: ${videoTitle}`);

            if (!isPlaying) {
              isPlaying = true;
              playNextInQueue(connection, message);
            }
          }

          collector.stop();
        });

        collector.on('end', () => {
          if (!reply.deleted) {
            reply.edit('Song selection expired.');
          }
        });
      });
    } catch (error) {
      console.error(error);
      message.reply('An error occurred while processing the command.');
    }
  } else if (message.content.startsWith('!skip')) {
    if (queue.length > 0) {
      // Stop the current song and play the next song in the queue
      audioPlayer.stop();
      message.channel.send('Skipped the current song.');
    } else {
      message.reply('There are no videos in the queue to skip.');
    }
  } else if (message.content.startsWith('!queue')) {
    if (queue.length > 0) {
      const queueList = queue.map((item, index) => `${index + 1}. ${item.title}`).join('\n');
      message.channel.send(`Current queue:\n${queueList}`);
    } else {
      message.reply('The queue is currently empty.');
    }
  } else if (message.content.startsWith('!pause')) {
    if (isPlaying) {
      audioPlayer.pause();
      message.channel.send('Playback paused.');
    } else {
      message.reply('There is no song currently playing.');
    }
  } else if (message.content.startsWith('!resume')) {
    if (audioPlayer.state.status === AudioPlayerStatus.Paused) {
      audioPlayer.unpause();
      message.channel.send('Playback resumed.');
    } else {
      message.reply('There is no paused song to resume.');
    }
  }  else if (message.content.startsWith('!remove')) {
    const index = parseInt(message.content.slice(8).trim(), 10);
    if (isNaN(index) || index < 1 || index > queue.length) {
      return message.reply('Invalid song index.');
    }
    const removedSong = queue.splice(index - 1, 1)[0];
    message.channel.send(`Removed song from queue: ${removedSong.title}`);
  } else if (message.content.startsWith('!skipto')) {
    const index = parseInt(message.content.slice(7).trim(), 10);
    if (isNaN(index) || index < 1 || index > queue.length) {
      return message.reply('Invalid song index.');
    }
    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
      return message.reply('I am not currently connected to a voice channel.');
    }
    audioPlayer.stop();
    queue.splice(0, index - 1);
    playNextInQueue(connection, message);
    message.channel.send(`Skipping to song ${index} in the queue.`);
  } else if (message.content.startsWith('!lyrics')) {
    const currentSong = queue[0];
    if (!currentSong) {
      return message.reply('There is no song currently playing.');
    }

    const { title } = currentSong;

    try {
      const lyrics = await lyricsFinder(title);

      if (!lyrics) {
        return message.reply(`Lyrics not found for the song: ${title}`);
      }

      const embed = new MessageEmbed()
        .setTitle(`Lyrics for: ${title}`)
        .setDescription(lyrics)
        .setColor('#F8F8F8');

      message.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      message.reply('An error occurred while fetching the lyrics.');
    }
  }
});

function playNextInQueue(connection, message) {
  if (queue.length > 0) {
    const { resource, title } = queue[0];
    audioPlayer.play(resource);
    connection.subscribe(audioPlayer);
    isPlaying = true;

    message.channel.send(`Now playing: ${title}`);

    audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (loopSong) {
        const loopedSong = queue.shift();
        queue.push(loopedSong);
        audioPlayer.play(loopedSong.resource);
        message.channel.send(`Looping song: ${loopedSong.title}`);
      } else if (loopQueue) {
        const nextSong = queue.shift();
        queue.push(nextSong);
        audioPlayer.play(nextSong.resource);
        message.channel.send(`Looping queue: ${nextSong.title}`);
      } else {
        queue.shift();

        if (queue.length > 0) {
          const { resource, title } = queue[0];
          audioPlayer.play(resource);
          message.channel.send(`Now playing: ${title}`);
        } else {
          if (connection && !connection.destroyed) {
            connection.destroy();
          }
          isPlaying = false;
        }
      }
    });
  }
}

client.login(process.env.Token); // Replace with your bot token
