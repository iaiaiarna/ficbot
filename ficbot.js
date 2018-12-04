#!/usr/bin/env node
'use strict'
require('@iarna/cli')(main)
// These are yargs config for what goes on the commandline.
  .usage('$0 <conffile>')
  .demand(1)
  .help()

const fs = require('fs')
const qr = require('@perl/qr')
const qw = require('@perl/qw')
const TOML = require('@iarna/toml')
const Discord = require('discord.js');
const DiscoBot = require('@iarna/discobot')
const moment = require('moment')
const Fic = require('fetch-fic').Fic
const Site = require('fetch-fic').Site
const ficInflate = require('fetch-fic').ficInflate
const fetch = require('fetch-fic/util/fetch.js')
const isFandom = require('./is-fandom.js')
const fun = require('funstream')
const ldjson = require('ldjson-stream')
const uniq = require('./uniq.js')
const path = require('path')
const HTMLToMarkdown = require("./html-to-markdown.js")
const approx = require('approximate-number');

const ratingColors = {
  'General Audiences': 0x00a000,
  'Teen And Up Audiences': 0x50e050,
  'Mature': 0x303090,
  'Explicit': 0xf0d0f0
}

const xenSites = qr.join('|', qw`
  forums.spacebattles.com
  forums.sufficientvelocity.com
  forum.questionablequesting.com
  questionablequesting.com
`)
const siteMatchers = [
  qr`archiveofourown[.]org/works/\d+`,
  qr`www[.]fanfiction[.]net/s/\d+`,
  qr`${xenSites}/(?:threads|posts)/[^/]*\d+`,
  qr`www.parahumans.net/?`,
  qr`parahumans.wordpress.com/?`,
  qr`seananmcguire[.]com`,
  qr`en.wikipedia[.]org/wiki/\w+`
]

const DEFAULTS = {
  fanficdb: `./Fanfic.json`,
  substitutions: `./substitutions`
}

let authors
let db = {
  authors: {},
  list: {},
  link: {}
}
let subst = {}

function addToDB (fic) {
  db.list[fic.identifiers.filter(_ => /^url:/.test(_))[0] || fic.identifiers[0] || 'url:' + fic.link] = fic
  for (let link of fic.links) {
    link = link.replace(/^url:/, '')
    try {
      const site = Site.fromUrl(link)
      const normalized = site.normalizeFicLink(link)
      db.link[normalized] = fic
    } catch (_) {
      db.link[link] = fic
    }
  }
  if (!fic.authors) {
    if (fic.author) {
      fic.authors = [{name: fic.author, link: fic.authorurl}]
    } else {
      fic.authors = []
    }
  }
  fic.authors = fic.authors.map(author => {
    if (db.authors.has(author.link)) {
      const realAuthor = db.authors.get(author.link)
      if (!realAuthor.fics) realAuthor.fics = new Set()
      realAuthor.fics.add(fic)
      return realAuthor
    } else {
      return author
    }
  })
  return fic
}

async function reloadSubst (bot) {
  for (let type of qw`xover fics chars tags cats series`) {
    try {
      const src = await fs.promises.readFile(`${bot.conf.substitutions}/${type}.js`, 'utf8')
      const data = {exports: {}}
      eval('((module) => { ' + src + '})(data)')
      subst[type] = data.exports
    } catch (_) {
      subst[type] = {}
    }
  }
}

async function reloadDB (bot) {
  if (bot.conf.authors) {
    db.authors = await require(path.resolve(bot.conf.authors))()
  } else {
    db.authors = new Map()
  }
  await fun(fs.createReadStream(bot.conf.fanficdb)).pipe(ldjson()).forEach(addToDB)
  console.log(Object.keys(db.link).length, 'links under management')
}

// @iarna/cli above will run this when the process starts
async function main (opts, conffile) {
  const bot = await DiscoBot.create(Object.assign({}, DEFAULTS, TOML.parse(fs.readFileSync(conffile))))
  await reloadDB(bot)
  await reloadSubst(bot)
  bot.addCommand('reload-subs', {
    filter: $ => $.msg.author.id === bot.conf.superadmin,
    usage: 'reload-subs',
    description: 'Reload substitutions',
    action: async function ($) {
      await this.withSpin($, reloadSubst($.bot))
      return $.msg.reply('Substitutions reloaded')
    }
  })
  bot.addCommand('reload-db', {
    filter: $ => $.msg.author.id === bot.conf.superadmin,
    usage: 'reload-db',
    description: 'Reload fic database',
    action: async function($) {
      await this.withSpin($, reloadDB($.bot))
      return $.msg.reply('Database reloaded')
    }
  })
  bot.addCommand('fic', {
    usage: 'fic <ficurls...>',
    description: 'Show what we know about a fic',
    action: async function ($, {ficurls}) {
      const match = (await Promise.all(ficurls.map(_ => expandURL($, _)))).filter(_ => _)
      if (!match.length) return $.msg.reply('Could not find any URLs of supported sites in ' + ficurls.join(', '), {split: true})
    }
  })
  bot.addCommand('author', {
    usage: 'author <name|url>',
    description: 'Show what we know about a fic',
    action: async function ($, {name,url}) {
      const against = name.trim().replace(/^<(.*)>$/, '$1').trim()
      const match = await expandAuthor($, against)
      if (!match) return $.msg.reply('Could not a matching author for ' + against, {split: true})
    }
  })
  bot.addCommand(null, {
    action: async function ($, cmdline) {
      if (!qr`https?://${qr.join('|', siteMatchers)}`.test(cmdline)) return
      return expandURL($, cmdline)
    }
  })
  const defaultStatus = bot.status
  bot.status = $ => defaultStatus.call(bot, $)
    + '\nServing ' + Object.keys(db.link).length + ' links to ' + Object.keys(db.list).length + ' fic by ' + db.authors.length + ' authors'
  await bot.login()
}

function truncate (str, len) {
  if (str.length <= len) return str
  return str.slice(0,len-1) + '…'
}

async function expandAuthor ($, au) {
  if (!db.authors.has(au)) return false
  const authors = db.authors.getAll(au)
  if (authors.length === 1) {
    let [auth] = authors
    const embed = new Discord.RichEmbed()
    embed.setTitle(truncate(auth.name, 256))
    embed.setURL(auth.link)
    const [ acct ] = auth.account.filter(_ => _.image)
    if (acct) embed.setThumbnail(acct.image)
    console.log(embed, acct, auth)
    const sites = []
    for (let acct of auth.account) {
      sites.push(`[${acct.name}@${linkSite(acct.link)}](${acct.link})`)
    }
    embed.addField('Active on:', nicelist(sites))
    const fics = (auth.fics ? [...auth.fics] : []).sort((aa, bb) => {
      return String(bb.modified).localeCompare(String(aa.modified))
    })
    if (fics.length) {    
      const fandoms = uniq(fics.map(_ => _.fandom).filter(_ => _).sort())
      const ficEntries = []
      let ii = 0
      for (let fic of fics) {
        const link = fic.links[0]
        const site = linkSite(link)
        const chapters = fic.chapters ? fic.chapters.length : 1
        if (!chapters) continue
        if (++ii > 10) continue
        const status = (fic.status === 'complete' || fic.status === 'one-shot') ? `${fic.status}, ` : 'in-progress, '
        const normalized = Site.fromUrl(link).normalizeFicLink(link)
        const prefix = `**[${site}](${normalized}): ${normalized}**\n**${status}${chapters} chapters, ${approx(fic.words)} words, last updated ${relativeDate(fic.modified)}**`
        const maxDescLength = 1023 - prefix.length
        const desc = fic.comments && truncate((await HTMLToMarkdown(fic.comments)).trim(), 1023 - prefix.length)
        let title = fic.title
        const isSnippet = !fic.identifiers.some(_ => /^top:/.test(_)) && fic.tags.some(_ => _ === 'Snippets')
        if (isSnippet) title = title.replace(/^[^:]+: /, '')
        ficEntries.push([`${ii}. ${title}`, prefix + (desc ? `\n${desc}` : '')])
      }
      embed.addField('Has written:', ii + ' fics for ' + nicelist(fandoms))
      ficEntries.forEach(_ => embed.addField(..._))
    }
    await $.msg.channel.send({embed})
    return true
  } else {
    await $.msg.channel.send(au + ' can refer to multiple authors:', {split: true})
    for (let auth of authors) {
      await expandAuthor($, auth.link)
    }
    return true
  }
}

function nicelist (arr) {
  if (arr.length === 1) return arr[0]
  const last = arr.slice(-1)
  return arr.slice(0, -1).join(', ') + ' and ' + last
}

async function expandURL ($, cmdline) {
  const urls = cmdline.match(qr.g`(https?://${qr.join('|', siteMatchers)})`)
  if (!urls) return
  const toFetch = urls.map(async match => {
    try {
      const site = Site.fromUrl(match)
      const normalized = site.normalizeFicLink(match)
      const fic = db.link[normalized]
      if (fic) return {...fic, link: normalized}
      if (!fic) {
        const fic = await ficInflate(Fic.fromUrl(fetch, normalized), fetch)
        return addToDB(ficnormalize(fic))
      }
    } catch (ex) {
      console.error('expandURL', match, ex)
    }
  })
  // spin while we download fics
  const fics = await $.bot.withSpin($, Promise.all(toFetch))
  // wait till we finish posting about all the fics to return
  await Promise.all(fics.map(async fic => {
    if (!fic) return
    const embed = new Discord.RichEmbed()
    let cover = fic.cover || fic.art
    if (fic.artFiles && fic.artFiles.length) {
      cover = 'https://shared.by.re-becca.org/misc/worm/image-cache/' +
        path.relative('/Users/rebecca/Public/misc/worm/image-cache', fic.artFiles[0])
    }
    const rawTags = uniq(fic.tags.map(_ => _.replace(/[|].*$/, '')))
    const rating = tag(rawTags, 'rating')
    const isWorm = isFandom('Worm').or('Ward')(fic)
    const isExplicit = rawTags.some(_ => _ === 'rating:Explicit')
    const isNSFW = rawTags.some(_ => _ === 'NSFW') || isExplicit
    const isSnippet = !fic.identifiers.some(_ => /^top:/.test(_)) && rawTags.some(_ => _ === 'Snippets')
    const isSnippets = fic.identifiers.some(_ => /^top:/.test(_)) && rawTags.some(_ => _ === 'Snippets')
    const series = (fic.series_index > 1 && fic.series) || tag(rawTags, 'follows')
    const follows = (series && series !== fic.title) && tagify(series, subst.fics)
    const chapters = fic.chapters ? fic.chapters.filter(ch => !ch.type || ch.type === 'chapter').length : 1
    const links = {}
    fic.links.forEach(l => { if (!links[linkSite(l)]) links[linkSite(l)] = l })
    const genre = tags(rawTags, 'genre')
    const xover = tags(rawTags, 'xover')
    const fusion = tags(rawTags, 'fusion')
    const category = tags(rawTags, 'category')
    const charLinks = isWorm ? subst.chars : {}
    const cn = tags(rawTags, 'cn')
    const characters = tags(rawTags, 'character')
       .map(t => t.replace(/ \(Worm\)/, '').replace(/ - Character/i, ''))
    const canon = tags(rawTags, 'canon')
    const ships = [fic.otn.map(t => tagify(t, charLinks)).join('/')]
      .concat(tags(rawTags, 'ship')).map(t => tagify(t, charLinks))
      .filter(v => v)
    const friendships = [fic.ftn.map(t => tagify(t, charLinks)).join(' & ')]
      .concat(tags(rawTags, 'friendship')).map(t => tagify(t, charLinks))
      .filter(v => v)
    const pov = fic.pov || tags(rawTags, 'povgender').join(',')
    const meta = tags(rawTags, 'meta')
    const seriesTags = tags(rawTags, 'series').map(t => tagify(t, subst.series))
    const tagList = rawTags.filter(t => !/^(?:status|series|collection|cn|pov|povgender|ship|friendship|canon|follows|genre|fandom|xover|fusion|meta|rating|rated|character|category|language):|^(?:NSFW|Quest|Snippets)$/i.test(t))
      .filter(t => t !== 'skip-sfw')
      .map(t => t.replace(/^freeform:(?:title:)?/, ''))
      .map(t => /altpower:/.test(t) ? tagify(t, Object.assign({}, subst.xover))  : t)

    if (cover) embed.setThumbnail(cover)
    if (ratingColors[rating]) embed.setColor(ratingColors[rating])
    let collectionName = fic.collection || fic.fandom
    if (isNSFW) collectionName += ' (NSFW)'
    embed.setAuthor(collectionName)
    const title = isSnippet ? fic.title.replace(/^[^:]+: /, '') : fic.title
    embed.setTitle(truncate(title, 256))
    embed.setURL(fic.link)
    embed.setTimestamp(new Date(fic.modified))
    fic.authors.forEach(_ => {
      embed.addField('Author', `[${truncate(_.name, 200)}](${_.link})`, true)
    })
    if (fic.created) embed.addField('Created on', relativeDate(fic.created), true)
    embed.addField('Total length', `${cstr(chapters)}, ${approx(fic.words)} words` +
      ' (' + Object.keys(links).map(_ =>`[${_}](${links[_]})`).join(', ') + ')', true)
    if (follows) {
      embed.addField('Follows', truncate(follows, 1024), true)
    }
    if (fic.rewrite && fic.rewrite_index > 1) {
      embed.addField('Rewrite of', truncate(tagify(fic.rewrite, subst.fics), 1024), true)
    }
    if (genre.length !== 0) embed.addField('Genre', truncate(genre.join(', '), 1024), true)
    if (category.length !== 0) embed.addField('Category', truncate(strify(category, subst.cats), 1024), true)
    if (fic.fandom !== fic.collection) embed.addField('Fandom', fic.fandom, true, true)
    if (xover.length !== 0) embed.addField('Crossover', truncate(strify(xover, subst.xover), 1024), true)
    if (fusion.length !== 0) embed.addField('Fusion', truncate(strify(fusion, subst.xover), 1024), true)
    if (meta.length !== 0) embed.addField('Meta-fanfiction of', truncate(strify(meta, subst.fics), 1024), true)
    if (seriesTags.length !== 0) embed.addField('Series', truncate(seriesTags.join(', '), 1024), true)
    if (pov.length) embed.addField('POV', truncate(strify(pov, charLinks), 1024), true)
    if (ships.length) embed.addField('Romantic pairing', truncate(ships.join(', '), 1024), true)
    if (friendships.length) embed.addField('Friendship pairing', truncate(friendships.join(', '), 1024), true)
    if (canon.length) embed.addField('Relationship to Canon', truncate(strify(canon, subst.tags), 1024), true)
    if (characters.length) embed.addField('Characters', truncate(strify(characters, charLinks, subst.xover), 1024), true)
    if (rating) embed.addField('Rating', rating, true)
    if (cn.length) embed.addField('Content Notes', truncate(cn.join(', '), 1024), true)

    if (tagList.length) {
      const tagstr = strify(tagList, subst.tags, charLinks, subst.xover)
      embed.addField('Tags', isExplicit ? `[Hover to View](https://shared.by.re-becca.org/empty.png "${tagstr}")` : tagstr)
    }

    if (fic.comments) {
      embed.setDescription(truncate((await HTMLToMarkdown(fic.comments)).trim(), 2048))
    }
    let footer = ''
    const status = (fic.status === 'complete' || fic.status === 'one-shot') ? `${fic.status}, ` : 'in-progress'
    footer += status
    if (footer) embed.setFooter(footer)
    await $.msg.channel.send({embed})
  }))
  return true
}

function ficnormalize (fic) {
  const fandom = tag(fic.tags, 'fandom')
  return {
    identifiers: [],
    title: fic.title,
    link: fic.link,
    links: [fic.link],
    cover: fic.cover,
    art: fic.art,
    artFiles: [],
    fandom: fandom,
    collection: fandom,
    created: fic.created || fic.modified,
    modified: fic.modified || fic.created,
    authors: fic.authors,
    comments: fic.description || fic.notes,
    status: tag(fic.tags, 'status'),
    tags: fic.tags,
    words: fic.words,
    chapters: fic.chapters,
    otn: [],
    ftn: []
  }
}

function tag (list, prefix) {
  return tags(list, prefix)[0]
}
function tags (list, prefix) {
  return list.filter(_ => qr`^${prefix}:`.test(_)).map(_ => _.slice(prefix.length + 1))
}

function linkSite (link) {
  let cat = 'link'
  if (/spacebattles/.test(link)) {
    cat = 'SB'
  } else if (/sufficientvelocity/.test(link)) {
    cat = 'SV'
  } else if (/questionablequesting/.test(link)) {
    cat = 'QQ'
  } else if (/archiveofourown/.test(link)) {
    cat = 'AO3'
  } else if (/fanfiction.net/.test(link)) {
    cat = 'FF'
  } else if (/wattpad/.test(link)) {
    cat = 'wattpad'
  }
  return cat
}

function tagify (thing, ...linkSets) {
  if (!thing) thing = ''
  for (let links of linkSets) {
    for (let link of Object.keys(links).sort((a, b) => b.length - a.length)) {
      let linkre = qr.g`(^|\b|\W)(${link})((?:\b\W|$)(?:[^<]*$|[^<]*<[^/]))`
      thing = thing.replace(linkre,
        (str, m1, m2, m3) => m1 + makeLink(m2, shortlink(links[link])) + m3)
    }
  }
  return thing
}
function makeLink (label, href) {
  return `[${label}](${href})`
}
function shortlink (link) {
  return xenlink(link)
//               .replace(/^https:/, '')
}
function xenlink (link) {
  return link.replace(/[/]threads[/].*#post-(\d+)/, '/posts/$1')
             .replace(/[/]threads[/](?:[^.]+[.])?(\d+)/, '/threads/$1')
             .replace(/[/]members[/](?:[^.]+[.])?(\d+)[/]?/, '/members/$1')
             .replace(/[/]works[/](\d+)[/]chapters[/]\d+[/]?$/, '/works/$1')
             .replace(/[/]$/, '')
             .replace(/forum.question/, 'question')
             .replace(/[/]fanfiction[.]net/, '/www.fiction.net')
             .replace(/[/]s[/](\d+)([/]\d+)?(?:[/].*)?$/, '/s/$1$2')
             .replace(/forums.sufficientvelocity/, 'sufficientvelocity')
}
function relativeDate (updated) {
  updated = moment(updated)
  const updatedStr = updated.isSameOrAfter(moment().subtract(7, 'day'))
                   ? updated.format('ddd [at] h a [UTC]')
                   : updated.isSameOrAfter(moment().subtract(1, 'year'))
                   ? updated.format('Do MMM')
                   : updated.format('Do MMM, Y')
  return updatedStr
}
function cstr (chapters, chapterPrefix) {
  return numof(chapters, 'chapter', 'chapters', chapterPrefix)
}
function numof (things, kind, kinds, prefix) {
  const pre = things && prefix ? `${prefix} ` : ''
  if (things === 1) {
    return `${things} ${pre}${kind}`
  } else {
    return `${things} ${pre}${kinds}`
  }
}
function strify (things, ...links) {
  return linkUp(things, links).join(', ')
}
function linkUp (things, links) {
  return (things||[]).map(thing => tagify(thing, ...links))
}
