'use strict'
require('@iarna/cli')(main)
// These are yargs config for what goes on the commandline.
  .usage('$0 <conffile>')
  .demand(1)
  .help()

const fs = require('fs')
const qr = require('@perl/qr')
const TOML = require('@iarna/toml')
const Discord = require('discord.js');

const DEFAULTS = {
  token: null,
  servers: {},
  serversById: {}
}
let conf
let client

// @iarna/cli above will run this when the process starts
async function main (opts, conffile) {
  conf = Object.assign({}, DEFAULTS, TOML.parse(fs.readFileSync(conffile)))

  client = new Discord.Client()
    .on('ready',  eventRun(clientReady))
    .on('error',  eventRun(clientError))
    .on('message',  eventRun(clientMessage))
    .on('messageReactionAdd',  eventRun(clientMessageReactionAdd))
    .on('guildMemberAdd',  eventRun(clientGuildMemberAdd))

  client.login(conf.token)
}

// this little wrapper exists so that our async event handlers don't throw
// away errors
function eventRun (fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (ex) {
      console.log(`Error running ${fn.name}:`, ex)
    }
  }
}

// called at startup, also after reconnects
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
      // This would only happen if the bot were added to another server and
      // I didn't have them in my config file. As bot DM functionality kinda breaks
      // with multiple servers, I may not ever do that.
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

async function sendDM (user, msg) {
  const dm = user.dmChannel || user.createDM()
  dm.send(msg)
}

async function clientMessage (msg) {
  if (msg.author.id === client.user.id) return // ignore our own messages
  // Helpful when debugging, but logs ALL messages on the discord
  //console.log('clientMessage', msg.channel.name, msg.author.id, msg.author.username, msg.author.discriminator, msg.content)
  let cmd = msg.content.trim()
  if (qr`^/\w`.test(cmd)) {
    cmd = cmd.slice(1)
  }

  let server
  if (msg.guild) {
    server = conf.serversById[msg.guild.id]
  } else {
    // the msg is a DM, so we have find the user's server on our own, this
    // is why we can't have nice things re: having this bot on multiple
    // servers
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
    await sendDM(msg.author, 'We were unable to determine exactly one server associated with you and this bot, the DM interface will be limited.')
  }

  // The callback defined on each `.command` will be run if appropriate by
  // yargs.
  const yargs = require('yargs')()
    .scriptName('')
    .usage('')
    .wrap(null)
    .exitProcess(false)
    .hide('version')
    .hide('help')
    .command('ping', 'check to see if the bot is alive', () => {}, argv => {
      const [, ...args] = argv._
      msg.reply(`I am alive` 
        + (server ? `\nYour server is ${name(server)}` : '')
        + (args.length ? '\nYour args were: ' + args.join('/') : ''))
    })
    .hide('ping')
  if (server) yargs
    .command('report', 'report inappropriate activity', () => {}, async argv => {
      const [, ...report] = argv._
      console.log(`**REPORT** from ${name(msg.author)} in ${name(msg.channel) || 'DM'}: ${report.join(' ')}`)
      if (msg.channel.name) msg.delete().catch(() => {})
      await server.moderation.send(`@here **REPORT** from ${msg.author} in ${msg.channel || 'DM'}: ${report.join(' ')}`)
      sendDM(msg.author, `Report in ${msg.channel || 'DM'} has been received: ${report.join(' ')}`).catch(() => {})
    })
    .command('admin', 'message the admins', () => {}, async argv => {
      const [, ...message] = argv._
      console.log(`Admin message from ${name(msg.author)} in ${name(msg.channel) || 'DM'}: ${message.join(' ')}`)
      if (msg.channel.name) msg.delete().catch(() => {})
      await server.moderation.send(`Admin message from ${msg.author} in ${msg.cahnnel || 'DM'}: ${message.join(' ')}`)
      sendDM(msg.author, `Message to admins sent from ${msg.channel || 'DM'}: ${message.join(' ')}`).catch(() => {})
    })
  if (msg.channel.name == null) yargs
    .demand(1)
    .recommendCommands()
    .showHelpOnFail(true)
    .help()

  // yargs.parse is how we get yargs to read the string we have instead of
  // our actual commandline.
  return yargs.parse(cmd, function (err, argv, output) {
    if (output) msg.reply(output)
  })
}

function name (thing) {
   if (!thing) return thing
   let name = thing.name || thing.username
   if (thing.discriminator) name += '#' + thing.discriminator
   return name
}

async function clientGuildMemberAdd (gm) {
  const server = conf.serversById[gm.guild.id]
  await server.moderation.send(`Welcome to the server ${gm.user}! We are _so_ happy to see you! :heartpulse: Please check out the pinned message in this channel for the why's and whatfors of this server, plus our code of conduct!`)
}
