'use strict'
module.exports = HTMLToMarkdown

function HTMLToMarkdown (html) {
  return new Parser().parse(html)
}

function nothing () {}

class Parser {
  constructor () {
    this.output = []
    this.lineBuffer = ''
    this.tagBuffer = {}
    this.accumulatingContent = true

    this.tags = {
      a: {
        start: (tag, attrs) => {
          const href = attrs.filter(attr => attr.name === 'href')
          if (href.length === 0) {
            this.linkDest = null
            return
          }
          this.linkDest = href[0].value
          this.addText(`[`)
        },
        end: () => {
          if (this.linkDest) this.addText(`](${this.linkDest})`)
        }
      },
      abbr: this.inline(),
      acronym: this.inline(),
      address: this.block('*', '*'),
      article: this.block(),
      aside: this.block(),
      b: this.inline('**', '**'),
      big: this.inline(),
      blockquote: this.block('> ', ''),
      // body: ignore
      br: {
        start: () => this.endLine(),
        end: nothing
      },
      caption: this.inline(), // table related
      center: this.inline(),
      cite: this.inline('*', '*'),
      code: this.block('`', '`'),
      col: this.inline(),
      colgroup: this.inline(),
      dd: this.block('', ''),
      del: this.inline('~~', '~~'),
      dfn: this.inline(),
      div: this.block(),
      dl: this.block(),
      dt: this.block('**', '**'),
      em: this.inline('*', '*'),
      figcaption: this.block(),
      figure: this.block(),
      footer: this.block(),
      h1: this.paragraph('# ', ''), // 2em
      h2: this.paragraph('## ', ''), // 1.5em
      h3: this.paragraph('### ', ''), // 1.17em
      h4: this.paragraph('#### ', ''),
      h5: this.paragraph('##### ', ''), // 0.83em
      h6: this.paragraph('######', ''), // 0.67em
      // head: ignore
      header: this.block(),
      hgroup: this.block(),
      hr: this.block('---', null, false),
      i: this.inline('*', '*'),
      img: {
        start: (tag, attrs) => {
          const src = attrs.filter(attr => attr.name === 'src')
          this.addText(`[!${src[0].alt||''}](${src[0].value})`)
        },
        end: () => { }
      },
      ins: this.inline('*', '*'),
      kbd: this.inline('`', '`'),
      li: this.block('* ', null, false),
      // link: supress
      menu: this.block(),
      ol: this.block(),
      output: this.inline(),
      p: this.paragraph(),
      pre: this.block('```', '```'),
      q: this.inline('“', '”'),
      // ruby: ignore
      // rp: ignore
      // rt: ignore
      s: this.inline('~~', '~~'),
      samp: this.inline('`', '`'),
      section: this.block(),
//      small: this.inline(),
      // source: supress (used w/ video)
      span: this.inline(),
      strike: this.inline('~~', '~~'),
      strong: this.inline('**', '**'),
      // style: suppress (BUT DON'T DO THIS FOREVER)
//      sub: this.inline(),
//      sup: this.inline(),
      table: this.inline(),
      // tbody: ignored
      td: this.inline(),
      // tfoot: ignored
      th: this.inline(),
      // thead: ignored
      time: this.inline(),
      // title: suppress
      tr: this.inline(),
//      u: this.inline('[u]', '[/u]'),
      ul: this.block(),
      var: this.inline('*', '*'),

      $ignore: {
        start: nothing,
        end: nothing
      },
      $suppress: {
        start: () => this.pauseText(),
        end: () => this.resumeText()
      }
    }

    this.tags.body = this.tags.$ignore
    this.tags.head = this.tags.$ignore
    this.tags.hgroup = this.tags.$ignore
    this.tags.html = this.tags.$ignore
    this.tags.link = this.tags.$suppress
    this.tags.ruby = this.tags.$ignore
    this.tags.rp = this.tags.$ignore
    this.tags.rt = this.tags.$ignore
    this.tags.script = this.tags.$suppress
    this.tags.source = this.tags.$suppress
    this.tags.style = this.tags.$suppress
    this.tags.tbody = this.tags.$ignore
    this.tags.tfoot = this.tags.$ignore
    this.tags.thead = this.tags.$ignore
    this.tags.time = this.tags.$ignore
    this.tags.title = this.tags.$suppress
    this.tags.wbr = this.tags.$ignore
    this.tags.u = this.tags.$ignore
    this.tags.big = this.tags.$ignore
    this.tags.small = this.tags.$ignore

    this.styles = {
      'border': () => '',
      'width': () => '',
      'display': () => '',
      'padding': () => '',
      'padding-left': () => '',
      'margin-left': () => '',
      'font-size': () => '',
      'font-weight': (tag, name, value) => {
        if (value === 'bold' || value === 'bolder' || value >= 700) {
          this.addText(`**`)
          return '**'
        } else {
          return ''
        }
      },
      'font-family': () => '',
      'vertical-align': () => '',
      'text-align': () => '',
    }
  }
  pauseText () {
    this.accumulatingContent = false
  }

  resumeText () {
    this.accumulatingContent = true
  }

  addText (text) {
    if (!this.accumulatingContent) return

    this.lineBuffer += text
  }

  currentLine () {
    return this.lineBuffer.replace(/\s+/g, ' ').trim()
  }

  endLine () {
    this.output.push(this.currentLine())
    this.lineBuffer = ''
  }

  textDecorations (which) {
    return value => which == null ? this.textDecorationsMap[value] : this.textDecorationsMap[value][which]
  }

  handleStyle (tag, attrs) {
    let foundUnknown = false
    let closeWith = ''
    for (let attr of attrs) {
      if (attr.name === 'style') {
        try {
          const parseCSS = require('css-parse')
          let css = parseCSS(`this { ${attr.value} }`)
          for (let decl of css.stylesheet.rules[0].declarations) {
            let style = this.styles[decl.property]
            if (style) {
              try {
                closeWith = style(tag, decl.property, decl.value) + closeWith
              } catch (ex) {
                process.emit('error', 'style crashed', ex)
              }
              if (/^xenforo-/.test(decl.property)) break
            } else {
              const util = require('util')
              process.emit('debug', `UNKNOWN CSS: ${util.inspect(decl)} ${tag} ${util.inspect(attrs)}`)
            }
          }
        } catch (ex) {
          process.emit('debug', 'INVALID CSS value=' + attr.value + ', ' + ex.stack)
        }
      }
    }
    if (!this.tagBuffer[tag]) this.tagBuffer[tag] = []
    this.tagBuffer[tag].push(closeWith)
  }

  inline (start, end, noStyle) {
    return {
      start: (tag, attrs) => {
        if (!noStyle) this.handleStyle(tag, attrs)
        if (start) this.addText(start)
      },
      end: (tag) => {
        if (end) this.addText(end)
        if (!noStyle) {
          const closeWith = this.tagBuffer[tag].pop()
          if (closeWith) this.addText(closeWith)
        }
      }
    }
  }

  block (start, end, noStyle) {
    return {
      start: (tag, attrs) => {
        if (this.currentLine().length) this.endLine()

        if (!noStyle) this.handleStyle(tag, attrs)
        if (start) this.addText(start)
      },
      end: (tag, attrs) => {
        if (end) this.addText(end)
        if (!noStyle) {
          const closeWith = this.tagBuffer[tag].pop()
          if (closeWith) this.addText(closeWith)
        }
        if (this.currentLine().length) this.endLine()
      }
    }
  }

  paragraph (start, end, noStyle) {
    return {
      start: (tag, attrs) => {
        // paragraphs end the current line, if any
        if (this.currentLine().length) this.endLine()

        // they also inject a blank line between themselves and any previous lines
        if (this.output.length && this.output[this.output.length - 1].length) this.endLine()
        if (!noStyle) this.handleStyle(tag, attrs)
        if (start) this.addText(start)
      },
      end: (tag, attrs) => {
        if (end) this.addText(end)
        if (!noStyle) {
          const closeWith = this.tagBuffer[tag].pop()
          if (closeWith) this.addText(closeWith)
        }
        if (this.currentLine().length) {
          this.endLine()
          this.endLine()
        } else {
          this.endLine()
        }
      }
    }
  }

  async parse (html$) {
    const parse5 = require('parse5')
    const parser = new parse5.SAXParser()
    parser.on('startTag', (tag, attrs, selfClosing, location) => {
      if (this.tags[tag]) {
        this.tags[tag].start(tag, attrs, selfClosing, location)
      } else {
        const util = require('util')
        process.emit('debug', 'UNKNOWN', 'tag:', tag + ', attrs:', util.inspect(attrs) + ', selfClosing:', !!selfClosing + ', location:', location, '\n')
      }
    })
    parser.on('endTag', (tag, attrs, selfClosing, location) => {
      if (this.tags[tag]) {
        this.tags[tag].end(tag, attrs, selfClosing, location)
      } else {
        const util = require('util')
        process.emit('debug', 'UNKNOWN', 'endtag:', tag + ', attrs:', util.inspect(attrs) + ', selfClosing:', !!selfClosing + ', location:', location, '\n')
      }
    })
    parser.on('text', text => this.addText(text))

    parser.end(await html$)
    const fun = require('funstream')
    await fun(parser)
    this.endLine()
    return this.output.join('\n').replace(/\n+$/, '') + '\n'
  }
}
