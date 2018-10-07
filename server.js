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
    .on('ready',  asyncHandler(clientReady))
    .on('error',  asyncHandler(clientError))
    .on('message',  asyncHandler(clientMessage))
    .on('messageReactionAdd',  asyncHandler(clientMessageReactionAdd))
    .on('guildMemberAdd',  asyncHandler(clientGuildMemberAdd))

  client.login(conf.token)
}

// this little wrapper exists so that our async event handlers don't throw
// away errors
function asyncHandler (fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (ex) {
      console.log(`Error running ${fn.name}:`, ex)
    }
  }
}

// Chatbot commands handled by clientMessage
const Commands = {
  'ping': {
    usage: 'ping [args...]',
    description: 'check to see if the bot is alive',
    action: async ($, {args})  => {
      return $.msg.reply(`I am alive`
        + ($.server ? `\nYour server is ${name($.server)}` : '')
        + (args ? '\nYour args were: ' + args.join('/') : ''))
    }
  },
  'report': {
    usage: 'report <reason...>',
    description: 'report inappropriate activity',
    filter: $ => $.server,
    action: async ($, {reason}) => {
      const chname = ($.msg.channel && $.msg.channel.type !== 'dm') ? $.msg.channel : 'DM'
      console.log(`**REPORT** from ${name($.msg.author)} in ${name(chname)}: ${reason.join(' ')}`)
      if ($.server.deleteReports && $.msg.channel.name) $.msg.delete().catch(() => {})
      await $.server.moderation.send(`@here **REPORT** from ${$.msg.author} in ${chname}: ${reason.join(' ')}`)
      if ($.server.deleteReports && $.msg.channel.name) {
        return sendDM($.msg.author, `Report in ${chname} has been sent to moderators: ${reason.join(' ')}`)
      } else {
        return $.msg.react($.msg.guild.emojis.find(_ => _.name === 'report'))
      }
    }
  },
  'admin': {
    description: 'message the admins',
    usage: 'admin <message...>',
    filter: $ => $.server,
    action: async ($, {message}) => {
      const chname = ($.msg.channel && $.msg.channel.type !== 'dm') ? $.msg.channel : 'DM'
      console.log(`Meessage to admins from ${name($.msg.author)} in ${name(chname)}: ${message.join(' ')}`)
      if ($.server.deleteReports && $.msg.channel.name) $.msg.delete().catch(() => {})
      await $.server.moderation.send(`Message to admins from ${$.msg.author} in ${chname}: ${message.join(' ')}`)
      if ($.server.deleteReports && $.msg.channel.name) {
        return sendDM($.msg.author, `Mesage to admins in ${chname} has been sent: ${message.join(' ')}`)
      } else {
        return $.msg.react('✅')
      }
    }
  }
}

// Client event handlers

async function clientError (err) {
  console.log(err)
}

async function clientGuildMemberAdd (gm) {
  const server = conf.serversById[gm.guild.id]
  return server.welcome.send(`Welcome to the server ${gm.user}! We are _so_ happy to see you! :heartpulse: Please check out the pinned message in this channel for the why's and whatfors of this server, plus our code of conduct!`)
}

async function clientMessageReactionAdd (mr, user) {
  if (!mr.message.guild) return // dm
  const server = conf.serversById[mr.message.guild.id]

  const report = `Reporting ${mr.message.author} saying “${mr.message}”`
  console.log(`**EMOJI REPORT** from ${name(user)} in ${name(mr.message.channel)}: ${report}`)
  await mr.remove(user)
  await server.moderation.send(`@here **EMOJI REPORT** from ${user} in ${mr.message.channel}: ${report}`)
  return sendDM(user, `Report in ${mr.message.channel} has been sent to moderators: ${report}`).catch(() => {})
}

async function clientMessage (msg) {
  if (msg.author.id === client.user.id) return // ignore our own messages
  // Helpful when debugging, but logs ALL messages on the discord
  //console.log('clientMessage', msg.channel.name, msg.author.id, msg.author.username, msg.author.discriminator, msg.content)
  let cmdline = msg.content.trim()
  if (qr`^/\w`.test(cmdline)) {
    cmdline = cmdline.slice(1)
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
  let output
  const yargs = require('yargs')()
    .scriptName('')
    .usage('')
    .wrap(null)
    .exitProcess(false)
    .hide('version')
    .hide('help')
  Object.keys(Commands).forEach(name => {
    const cmd = Commands[name]
    if (!cmd.filter || cmd.filter({msg, server})) {
      yargs.command(cmd.usage || name, cmd.description)
    }
  })
  if (msg.channel.type === 'dm') yargs
    .demand(1)
    .recommendCommands()

  // yargs.parse is how we get yargs to read the string we have instead of
  // our actual commandline. output handling for yargs help is… silly.
  yargs.parse(cmdline, (_1,_2,_3) => output = _3)
  if (output) return msg.reply(output)
  let argv = yargs.argv
  if (argv) {
    const cmd = Commands[argv._[0]]
    if (cmd) {
      return cmd.action({msg, server}, argv)
    } else if (msg.channel.type === 'dm') {
      yargs.showHelp((..._) => output = _)
      return msg.reply(output.join(' '))
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

// Utility functions

function name (thing) {
   if (!thing) return thing
   if (typeof thing === 'string') return thing
   let name = thing.name || thing.username
   if (thing.discriminator) name += '#' + thing.discriminator
   return name
}

async function sendDM (user, msg) {
  const dm = user.dmChannel || user.createDM()
  return dm.send(msg)
}
