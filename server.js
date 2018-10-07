'use strict'
require('@iarna/cli')(main)
  .demand(1)
  .help()

const fs = require('fs')
const qr = require('@perl/qr')
const TOML = require('@iarna/toml')
const Discord = require('discord.js');

const DEFAULTS = {
  token: null,
  id: null,
  servers: {},
  serversById: {}
}
let conf
let client

async function main (opts, conffile) {
  conf = Object.assign({}, DEFAULTS, TOML.parse(fs.readFileSync(conffile)))
  client = new Discord.Client()
    .on('ready', clientReady)
    .on('error', clientError)
    .on('message', clientMessage)
    .on('messageReactionAdd', clientMessageReactionAdd)

  client.login(conf.token)
}

function modChannel (guild) {
  const channel = guild.channels.find(ch => ch.name === conf.modChannel);
  // Do nothing if the channel wasn't found on this server
  if (!channel) return;
  // Send the message, mentioning the member
  channel.send(`Welcome to the server, ${member}`);
}

async function clientReady () {
  console.log(`Logged in as ${client.user.tag}!`);
  client.guilds.forEach(guild => {
  console.log(`Logged into ${guild.name}, ${guild.id}`);
    if (conf.servers[guild.name]) {
      const server = conf.servers[guild.name]
      conf.serversById[guild.id] = server
      server.name = guild.name
      guild.channels.forEach(ch => {
        if (ch.name === server.channels.moderation) {
          server.moderation = ch
        } else if (ch.name === server.channels.welcome) {
          server.welcome = ch
        }
      })
    } else {
      console.log(`Unknown server: ${guild.name}`)
      conf.serversById[guild.id] = conf.servers[guild.name] = {
        name: guild.name,
        channels: { moderation, welcome }
      }
    }
  })
}

async function clientError (err) {
  console.log(err)
}

async function clientMessageReactionAdd (mr, user) {
  if (!mr.message.guild) return // dm
  const server = conf.serversById[mr.message.guild.id]

  const report = `Reporting ${mr.message.author} saying “${mr.message}”`
  console.log(`**EMOJI REPORT** from ${name(user)} in ${name(mr.message.channel) || 'DM'}: ${report}`)
  await mr.remove(user)
  await server.moderation.send(`@here **EMOJI REPORT** from ${user} in ${mr.message.channel || 'DM'}: ${report}`)
  const dm = user.dmChannel || await user.createDM()
  dm.send(`Report in ${mr.message.channel || 'DM'} has been received: ${report}`).catch(() => {})
}

async function clientMessage (msg) {
  if (msg.author.id === conf.id) return
  try {  
//    console.log('clientMessage', msg.channel.name, msg.author.id, msg.author.username, msg.author.discriminator, msg.content)
    if (qr`^/\w`.test(msg)) {
      return await runCommand(msg, msg.content.trim().slice(1))
    } else if (msg.channel.name == null) {
      return await runCommand(msg, msg.content.trim())
    }
  } catch (ex) {
    console.log(ex)
  }
}

async function runCommand (msg, cmd, showHelp) {
  let server
  if (msg.guild) {
    server = conf.serversById[msg.guild.id]
  } else {
    const guilds = []
    for (let [, guild] of client.guilds) {
      try {
        await guild.fetchMember(msg.author, true)
        guilds.push(guild)
      } catch (ex) {
      }
    }
    if (guilds.length === 1) {
      server = conf.serversById[guilds[0].id]
    }
  }
  if (!server) {
    msg.author.dmChannel.send('We were unable to determine exactly one server associated with you and this bot, the DM interface will be limited.')
  }
  const yargs = require('yargs')()
    .scriptName('')
    .usage('')
    .wrap(null)
    .exitProcess(false)
    .hide('version')
    .hide('help')
    .hide('ping')
     .command('ping', 'check to see if the bot is alive', () => {}, argv => {    
      const [, ...args] = argv._
      msg.reply(`I am alive` 
        + (server ? `\nYour server is ${name(server)}` : '')
        + (args.length ? '\nYour args were: ' + args.join('/') : ''))
    })
  if (server) yargs
    .command('report', 'report inappropriate activity', () => {}, async argv => {
      const [, ...report] = argv._
      console.log(`**REPORT** from ${name(msg.author)} in ${name(msg.channel) || 'DM'}: ${report.join(' ')}`)
      if (msg.channel.name) msg.delete().catch(() => {})
      await server.moderation.send(`@here **REPORT** from ${msg.author} in ${msg.channel || 'DM'}: ${report.join(' ')}`)
      const dm = msg.author.dmChannel || await msg.author.createDM()
      dm.send(`Report in ${msg.channel || 'DM'} has been received: ${report.join(' ')}`).catch(() => {})
    })
    .command('admin', 'message the admins', () => {}, async argv => {
      const [, ...message] = argv._
      console.log(`Admin message from ${name(msg.author)} in ${name(msg.channel) || 'DM'}: ${message.join(' ')}`)
      if (msg.channel.name) msg.delete().catch(() => {})
      await server.moderation.send(`Admin message from ${msg.author} in ${msg.cahnnel || 'DM'}: ${message.join(' ')}`)
      const dm = msg.author.dmChannel || await msg.author.createDM()
      dm.send(`Message to admins sent from ${msg.channel || 'DM'}: ${message.join(' ')}`).catch(() => {})
    })
  if (msg.channel.name == null) yargs
    .demand(1)
    .recommendCommands()
    .showHelpOnFail(true)
    .help()

  yargs
    .parse(cmd, function (err, argv, output) {
      if (output) msg.reply(output)
    })
    .argv
}

function name (thing) {
   if (!thing) return thing
   let name = thing.name || thing.username
   if (thing.discriminator) name += '#' + thing.discriminator
   return name
}
