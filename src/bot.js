const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  StringSelectMenuBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
  SlashCommandBuilder, REST, Routes, AttachmentBuilder, ActivityType,
} = require('discord.js');

const store = require('./store');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cfg = (guildId) => store.get(guildId);

function baseEmbed(guildId) {
  const c = cfg(guildId);
  return new EmbedBuilder()
    .setColor(c.appearance.color)
    .setFooter({ text: c.appearance.footer })
    .setTimestamp();
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 86400)}j ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function welcomeVariables(text, member) {
  return String(text || '').replace(/\{(user|username|server|memberCount)\}/g, (_, key) => ({
    user: `<@${member.id}>`, username: member.user.username,
    server: member.guild.name, memberCount: String(member.guild.memberCount),
  })[key]);
}

client.on('guildMemberAdd', async (member) => {
  const welcome = cfg(member.guild.id).welcome;
  if (!welcome.enabled) return;
  const me = member.guild.members.me;
  if (!me) return;

  if (welcome.roleId) {
    const role = member.guild.roles.cache.get(welcome.roleId);
    if (!role) console.warn(`[Bienvenue] RÃ´le introuvable sur ${member.guild.name}`);
    else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) console.warn(`[Bienvenue] Permission GÃ©rer les rÃ´les manquante sur ${member.guild.name}`);
    else if (role.managed || role.position >= me.roles.highest.position) console.warn(`[Bienvenue] RÃ´le ${role.name} non attribuable par le bot`);
    else await member.roles.add(role, 'RÃ´le de bienvenue automatique').catch(err => console.error(`[Bienvenue] RÃ´le : ${err.message}`));
  }

  const channel = welcome.channelId && member.guild.channels.cache.get(welcome.channelId);
  if (!channel?.isTextBased()) return console.warn(`[Bienvenue] Salon introuvable sur ${member.guild.name}`);
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return console.warn(`[Bienvenue] Permissions Voir le salon / Envoyer des messages manquantes dans #${channel.name}`);
  }

  const payload = {};
  const content = welcomeVariables(welcome.message, member).slice(0, 2000);
  if (content) payload.content = content;
  if (welcome.embed?.enabled) {
    if (!permissions.has(PermissionFlagsBits.EmbedLinks)) console.warn(`[Bienvenue] Permission IntÃ©grer des liens manquante dans #${channel.name}`);
    else {
      const embed = new EmbedBuilder().setColor(welcome.embed.color || '#E01E37');
      const title = welcomeVariables(welcome.embed.title, member).slice(0, 256);
      const description = welcomeVariables(welcome.embed.description, member).slice(0, 4096);
      if (title) embed.setTitle(title);
      if (description) embed.setDescription(description);
      if (welcome.embed.thumbnail === 'avatar') embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
      payload.embeds = [embed];
    }
  }
  if (payload.content || payload.embeds) await channel.send(payload).catch(err => console.error(`[Bienvenue] Envoi : ${err.message}`));
});

async function sendLog(guild, embed) {
  const id = cfg(guild.id).moderation.logChannelId;
  if (!id) return;
  const chan = guild.channels.cache.get(id);
  if (chan) chan.send({ embeds: [embed] }).catch(() => {});
}

function canModerate(interaction, target) {
  if (target.id === interaction.user.id) return "Tu peux pas te sanctionner toi-mÃªme.";
  if (target.id === interaction.guild.ownerId) return "C'est le proprio du serveur.";
  if (target.roles.highest.position >= interaction.member.roles.highest.position
      && interaction.user.id !== interaction.guild.ownerId) {
    return "Cette personne a un rÃ´le Ã©gal ou supÃ©rieur au tien.";
  }
  if (target.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
    return "Cette personne est au-dessus du bot dans la hiÃ©rarchie des rÃ´les.";
  }
  return null;
}

// Applique la prÃ©sence dÃ©finie depuis le dashboard (rÃ©glage global)
function applyPresence() {
  const c = store.getGlobal().bot;
  client.user.setPresence({
    activities: [{ name: c.activityText, type: c.activityType }],
    status: c.status,
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  TICKETS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function panelComponents(guildId) {
  const c = cfg(guildId).ticket;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder(c.placeholder)
    .addOptions(c.types.map(t => ({
      label: t.label,
      value: t.id,
      description: t.description?.slice(0, 100) || undefined,
      emoji: t.emoji || undefined,
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

function panelEmbed(guildId, imageUrl) {
  const c = cfg(guildId).ticket;
  const embed = baseEmbed(guildId).setTitle(c.panelTitle).setDescription(c.panelDescription);
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

// Construit le message complet du panneau. Une image /uploads/... est jointe
// au message : Discord n'a ainsi pas besoin d'accÃ©der au serveur web local.
function panelMessage(guildId) {
  const image = cfg(guildId).ticket.panelImage;
  const files = [];
  let imageUrl;

  if (image && /^https?:\/\//i.test(image)) {
    imageUrl = image;
  } else if (image && image.startsWith('/uploads/')) {
    const filename = path.basename(image);
    const filePath = path.join(__dirname, '..', 'public', 'uploads', filename);
    if (fs.existsSync(filePath)) {
      imageUrl = `attachment://${filename}`;
      files.push(new AttachmentBuilder(filePath, { name: filename }));
    } else {
      console.warn(`Image du panneau introuvable : ${filePath}`);
    }
  }

  return {
    embeds: [panelEmbed(guildId, imageUrl)],
    components: panelComponents(guildId),
    files,
  };
}

// Le type du ticket est stockÃ© dans le topic : "ticket:USERID:TYPEID"
function parseTopic(topic) {
  if (!topic?.startsWith('ticket:')) return null;
  const [, userId, typeId] = topic.split(':');
  return { userId, typeId };
}

async function buildTranscript(channel) {
  let all = [];
  let before;
  while (all.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  const lines = all.reverse().map(m => {
    const date = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const files = m.attachments.map(a => `[fichier: ${a.url}]`).join(' ');
    return `[${date}] ${m.author.tag}: ${m.content} ${files}`.trim();
  });
  const header = `Transcript â€” ${channel.name}\nGÃ©nÃ©rÃ© le ${new Date().toLocaleString('fr-FR')}\n${'â”€'.repeat(50)}\n\n`;
  return Buffer.from(header + lines.join('\n'), 'utf8');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  COMMANDES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const commands = [
  new SlashCommandBuilder().setName('avatar').setDescription("Affiche l'avatar d'un membre")
    .addUserOption(o => o.setName('membre').setDescription('Le membre visÃ©'))
    .addBooleanOption(o => o.setName('serveur').setDescription('Avatar spÃ©cifique au serveur')),

  new SlashCommandBuilder().setName('banniere').setDescription("Affiche la banniÃ¨re d'un membre")
    .addUserOption(o => o.setName('membre').setDescription('Le membre visÃ©')),

  new SlashCommandBuilder().setName('userinfo').setDescription('Avatar + banniÃ¨re + infos du membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre visÃ©')),

  new SlashCommandBuilder().setName('statut').setDescription('Statut du serveur et du bot'),

  new SlashCommandBuilder().setName('panel').setDescription('Envoie le panneau de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('add').setDescription('Ajoute un membre au ticket')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),

  new SlashCommandBuilder().setName('remove').setDescription('Retire un membre du ticket')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),

  new SlashCommandBuilder().setName('kick').setDescription('Expulse un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder().setName('ban').setDescription('Bannit un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison'))
    .addIntegerOption(o => o.setName('purge').setDescription('Supprimer les messages des X derniers jours').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder().setName('unban').setDescription('DÃ©bannit un utilisateur')
    .addStringOption(o => o.setName('id').setDescription("ID de l'utilisateur").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder().setName('mute').setDescription('Exclusion temporaire')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('DurÃ©e en minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('raison').setDescription('Raison'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('unmute').setDescription("Retire l'exclusion")
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages')
    .addIntegerOption(o => o.setName('nombre').setDescription('1 Ã  100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('membre').setDescription('Cibler un membre'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map(c => c.toJSON());

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  DÃ‰MARRAGE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
client.once('clientReady', async () => {
  console.log(`âœ… Bot connectÃ© : ${client.user.tag}`);
  applyPresence();

  // Les commandes sont enregistrÃ©es sur chaque serveur oÃ¹ le bot est prÃ©sent
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  for (const [id, guild] of client.guilds.cache) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, id),
        { body: commands },
      );
      console.log(`âœ… ${commands.length} commandes â†’ ${guild.name}`);
    } catch (err) {
      console.error(`âŒ Commandes sur ${guild.name} : ${err.message}`);
    }
  }
});

client.on('guildCreate', async (guild) => {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), { body: commands })
    .then(() => console.log(`âœ… Commandes â†’ ${guild.name} (nouveau serveur)`))
    .catch(err => console.error(`âŒ ${guild.name} : ${err.message}`));
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  INTERACTIONS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelect(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'âŒ Une erreur est survenue.', ephemeral: true };
    if (interaction.replied || interaction.deferred) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

async function handleCommand(interaction) {
  const cmd = interaction.commandName;
  const gid = interaction.guild.id;

  if (cmd === 'avatar') {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const serveur = interaction.options.getBoolean('serveur') ?? false;
    const member = serveur ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
    const url = (serveur && member?.avatar)
      ? member.displayAvatarURL({ size: 4096, extension: 'png' })
      : user.displayAvatarURL({ size: 4096, extension: 'png' });

    return interaction.reply({ embeds: [baseEmbed(gid)
      .setTitle(`Avatar de ${user.username}`)
      .setImage(url)
      .setDescription(`[PNG](${user.displayAvatarURL({ extension: 'png', size: 4096 })}) â€¢ [WEBP](${user.displayAvatarURL({ extension: 'webp', size: 4096 })})`)] });
  }

  if (cmd === 'banniere') {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const fetched = await client.users.fetch(user.id, { force: true });
    const banner = fetched.bannerURL({ size: 4096, extension: 'png' });

    if (!banner) {
      return interaction.reply({ ephemeral: true, embeds: [baseEmbed(gid)
        .setTitle(`${user.username} n'a pas de banniÃ¨re`)
        .setDescription(fetched.hexAccentColor ? `Couleur de profil : \`${fetched.hexAccentColor}\`` : 'Aucune couleur de profil non plus.')] });
    }

    return interaction.reply({ embeds: [baseEmbed(gid)
      .setTitle(`BanniÃ¨re de ${user.username}`)
      .setImage(banner)
      .setDescription(`[Ouvrir en grand](${banner})`)] });
  }

  if (cmd === 'userinfo') {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const fetched = await client.users.fetch(user.id, { force: true });
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = baseEmbed(gid)
      .setTitle(user.username)
      .setThumbnail(user.displayAvatarURL({ size: 1024 }))
      .addFields(
        { name: 'ID', value: `\`${user.id}\``, inline: true },
        { name: 'Compte crÃ©Ã©', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      );

    if (member) {
      embed.addFields(
        { name: 'A rejoint', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: `RÃ´les (${member.roles.cache.size - 1})`,
          value: member.roles.cache.filter(r => r.id !== gid).map(r => r.toString()).join(' ').slice(0, 1024) || 'Aucun' },
      );
    }
    if (fetched.banner) embed.setImage(fetched.bannerURL({ size: 4096 }));
    return interaction.reply({ embeds: [embed] });
  }

  if (cmd === 'statut') {
    await interaction.deferReply();
    const g = interaction.guild;
    await g.members.fetch();
    const bots = g.members.cache.filter(m => m.user.bot).size;

    return interaction.editReply({ embeds: [baseEmbed(gid)
      .setTitle(`Statut â€” ${g.name}`)
      .setThumbnail(g.iconURL({ size: 512 }))
      .addFields(
        { name: 'ðŸ‘¥ Membres', value: `${g.memberCount - bots} humains\n${bots} bots`, inline: true },
        { name: 'ðŸ’¬ Salons', value: `${g.channels.cache.filter(c => c.type === ChannelType.GuildText).size} textuels\n${g.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size} vocaux`, inline: true },
        { name: 'ðŸŽ­ RÃ´les', value: `${g.roles.cache.size - 1}`, inline: true },
        { name: 'ðŸš€ Boosts', value: `Niveau ${g.premiumTier} (${g.premiumSubscriptionCount || 0})`, inline: true },
        { name: 'ðŸ“… CrÃ©Ã© le', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'ðŸ‘‘ PropriÃ©taire', value: `<@${g.ownerId}>`, inline: true },
        { name: 'ðŸ“¡ Latence', value: `${client.ws.ping} ms`, inline: true },
        { name: 'â±ï¸ Uptime', value: formatUptime(client.uptime), inline: true },
        { name: 'ðŸ§  RAM', value: `${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} Mo`, inline: true },
      )] });
  }

  if (cmd === 'panel') {
    await interaction.channel.send(panelMessage(gid));
    return interaction.reply({ content: 'âœ… Panneau envoyÃ©.', ephemeral: true });
  }

  if (cmd === 'add' || cmd === 'remove') {
    const t = parseTopic(interaction.channel.topic);
    if (!t) return interaction.reply({ content: "âŒ Cette commande s'utilise dans un ticket.", ephemeral: true });

    const user = interaction.options.getUser('membre');
    if (cmd === 'add') {
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      return interaction.reply(`âœ… ${user} a Ã©tÃ© ajoutÃ© au ticket.`);
    }
    await interaction.channel.permissionOverwrites.delete(user.id);
    return interaction.reply(`âœ… ${user} a Ã©tÃ© retirÃ© du ticket.`);
  }

  if (cmd === 'kick') {
    const user = interaction.options.getUser('membre');
    const raison = interaction.options.getString('raison') ?? 'Aucune raison fournie';
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return interaction.reply({ content: 'âŒ Membre introuvable.', ephemeral: true });

    const err = canModerate(interaction, target);
    if (err) return interaction.reply({ content: `âŒ ${err}`, ephemeral: true });

    if (cfg(gid).moderation.dmOnSanction) {
      await user.send(`Tu as Ã©tÃ© expulsÃ© de **${interaction.guild.name}**\nRaison : ${raison}`).catch(() => {});
    }
    await target.kick(`${interaction.user.tag} â€” ${raison}`);

    const embed = baseEmbed(gid).setTitle('ðŸ‘¢ Expulsion').addFields(
      { name: 'Membre', value: `${user.tag} (\`${user.id}\`)` },
      { name: 'ModÃ©rateur', value: `${interaction.user}` },
      { name: 'Raison', value: raison },
    );
    sendLog(interaction.guild, embed);
    return interaction.reply({ embeds: [embed] });
  }

  if (cmd === 'ban') {
    const user = interaction.options.getUser('membre');
    const raison = interaction.options.getString('raison') ?? 'Aucune raison fournie';
    const purge = interaction.options.getInteger('purge') ?? 0;
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (target) {
      const err = canModerate(interaction, target);
      if (err) return interaction.reply({ content: `âŒ ${err}`, ephemeral: true });
      if (cfg(gid).moderation.dmOnSanction) {
        await user.send(`Tu as Ã©tÃ© banni de **${interaction.guild.name}**\nRaison : ${raison}`).catch(() => {});
      }
    }

    await interaction.guild.members.ban(user.id, {
      reason: `${interaction.user.tag} â€” ${raison}`,
      deleteMessageSeconds: purge * 86400,
    });

    const embed = baseEmbed(gid).setTitle('ðŸ”¨ Bannissement').addFields(
      { name: 'Membre', value: `${user.tag} (\`${user.id}\`)` },
      { name: 'ModÃ©rateur', value: `${interaction.user}` },
      { name: 'Raison', value: raison },
      { name: 'Messages purgÃ©s', value: purge ? `${purge} jour(s)` : 'Non' },
    );
    sendLog(interaction.guild, embed);
    return interaction.reply({ embeds: [embed] });
  }

  if (cmd === 'unban') {
    const id = interaction.options.getString('id');
    try {
      await interaction.guild.bans.remove(id, `DÃ©banni par ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ content: "âŒ Cet ID n'est pas banni (ou est invalide).", ephemeral: true });
    }
    const embed = baseEmbed(gid).setTitle('â™»ï¸ DÃ©bannissement')
      .setDescription(`\`${id}\` a Ã©tÃ© dÃ©banni par ${interaction.user}`);
    sendLog(interaction.guild, embed);
    return interaction.reply({ embeds: [embed] });
  }

  if (cmd === 'mute') {
    const user = interaction.options.getUser('membre');
    const minutes = interaction.options.getInteger('minutes');
    const raison = interaction.options.getString('raison') ?? 'Aucune raison fournie';
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return interaction.reply({ content: 'âŒ Membre introuvable.', ephemeral: true });

    const err = canModerate(interaction, target);
    if (err) return interaction.reply({ content: `âŒ ${err}`, ephemeral: true });

    await target.timeout(minutes * 60000, `${interaction.user.tag} â€” ${raison}`);

    const embed = baseEmbed(gid).setTitle('ðŸ”‡ Exclusion temporaire').addFields(
      { name: 'Membre', value: `${user.tag} (\`${user.id}\`)` },
      { name: 'DurÃ©e', value: `${minutes} minute(s)` },
      { name: 'Fin', value: `<t:${Math.floor((Date.now() + minutes * 60000) / 1000)}:R>` },
      { name: 'Raison', value: raison },
    );
    sendLog(interaction.guild, embed);
    return interaction.reply({ embeds: [embed] });
  }

  if (cmd === 'unmute') {
    const user = interaction.options.getUser('membre');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return interaction.reply({ content: 'âŒ Membre introuvable.', ephemeral: true });
    await target.timeout(null);
    return interaction.reply(`âœ… ${user.tag} n'est plus exclu.`);
  }

  if (cmd === 'clear') {
    const nombre = interaction.options.getInteger('nombre');
    const user = interaction.options.getUser('membre');
    await interaction.deferReply({ ephemeral: true });

    let messages = await interaction.channel.messages.fetch({ limit: 100 });
    if (user) messages = messages.filter(m => m.author.id === user.id);
    messages = [...messages.values()].slice(0, nombre);

    const recents = messages.filter(m => Date.now() - m.createdTimestamp < 14 * 86400000);
    const deleted = await interaction.channel.bulkDelete(recents, true);

    return interaction.editReply(
      `âœ… ${deleted.size} message(s) supprimÃ©(s).` +
      (messages.length > recents.length ? "\nâš ï¸ Certains dataient de +14 jours, Discord interdit leur suppression en masse." : '')
    );
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  MENU DÃ‰ROULANT â†’ OUVERTURE DU TICKET
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleSelect(interaction) {
  if (interaction.customId !== 'ticket_select') return;
  await interaction.deferReply({ ephemeral: true });

  const gid = interaction.guild.id;
  const c = cfg(gid).ticket;
  const type = c.types.find(t => t.id === interaction.values[0]);

  const existant = interaction.guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildText && parseTopic(ch.topic)?.userId === interaction.user.id
  );
  if (existant) return interaction.editReply(`âŒ T'as dÃ©jÃ  un ticket ouvert : ${existant}`);

  const overwrites = [
    { id: gid, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
    ]},
    { id: client.user.id, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles,
    ]},
  ];
  if (c.staffRoleId) {
    overwrites.push({ id: c.staffRoleId, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
    ]});
  }

  const channel = await interaction.guild.channels.create({
    name: `${type.id}-${interaction.user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: c.categoryId || null,
    topic: `ticket:${interaction.user.id}:${type.id}`,
    permissionOverwrites: overwrites,
  });

  const embed = baseEmbed(gid)
    .setTitle(`${type.emoji || ''} ${type.label}`.trim())
    .setDescription(c.welcomeMessage)
    .addFields({ name: 'Ouvert par', value: `${interaction.user}`, inline: true })
    .setThumbnail(interaction.user.displayAvatarURL());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Prendre en charge').setEmoji('âœ‹').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('ðŸ”’').setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `${interaction.user}${c.staffRoleId ? ` <@&${c.staffRoleId}>` : ''}`,
    embeds: [embed],
    components: [row],
  });

  // Le menu reste utilisable pour les autres : on le rÃ©affiche tel quel
  await interaction.message.edit({ components: panelComponents(gid) }).catch(() => {});

  return interaction.editReply(`âœ… Ticket crÃ©Ã© : ${channel}`);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  BOUTONS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleButton(interaction) {
  const gid = interaction.guild.id;
  const id = interaction.customId;

  if (id === 'ticket_claim') {
    const staffId = cfg(gid).ticket.staffRoleId;
    if (staffId && !interaction.member.roles.cache.has(staffId)) {
      return interaction.reply({ content: "âŒ RÃ©servÃ© Ã  l'Ã©quipe.", ephemeral: true });
    }
    await interaction.channel.setName(`âœ‹-${interaction.channel.name}`.slice(0, 100)).catch(() => {});
    return interaction.reply(`âœ‹ ${interaction.user} prend ce ticket en charge.`);
  }

  if (id === 'ticket_close') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({ content: 'Fermer et supprimer ce ticket ?', components: [row], ephemeral: true });
  }

  if (id === 'ticket_cancel') {
    return interaction.update({ content: 'AnnulÃ©.', components: [] });
  }

  if (id === 'ticket_confirm') {
    await interaction.update({ content: 'ðŸ”’ Fermeture dans 5 secondes...', components: [] });
    await closeTicket(interaction.channel, interaction.user);
  }
}

async function closeTicket(channel, closedBy) {
  const gid = channel.guild.id;
  const c = cfg(gid).ticket;
  const t = parseTopic(channel.topic);

  const embed = baseEmbed(gid).setTitle('ðŸŽ« Ticket fermÃ©').addFields(
    { name: 'Salon', value: `\`${channel.name}\``, inline: true },
    { name: 'Ouvert par', value: t ? `<@${t.userId}>` : 'Inconnu', inline: true },
    { name: 'FermÃ© par', value: `${closedBy}`, inline: true },
  );

  const files = [];
  if (c.transcript) {
    try {
      const buf = await buildTranscript(channel);
      files.push(new AttachmentBuilder(buf, { name: `${channel.name}.txt` }));
    } catch (e) { console.error('Transcript :', e.message); }
  }

  const logId = c.logChannelId || cfg(gid).moderation.logChannelId;
  if (logId) {
    const log = channel.guild.channels.cache.get(logId);
    if (log) await log.send({ embeds: [embed], files }).catch(() => {});
  }

  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

module.exports = { client, applyPresence, panelEmbed, panelComponents, panelMessage, parseTopic, closeTicket, formatUptime, welcomeVariables };

