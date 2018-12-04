'use strict'
module.exports = isFandom

function isFandom (fandom) {
  const lcFandom = fandom.toLowerCase()
  const xf = [ `xover:${lcFandom}`, `fusion:${lcFandom}` ]
  return wrapOr(fic => {
    const ficFandom = (fic.fandom || '').toLowerCase()
    return ficFandom == lcFandom || fic.tags.some(t => xf.indexOf(t.toLowerCase()) !== -1)
  })
}

function wrapOr (isThisFandom) {
  isThisFandom.or = fandom => {
    const isThatFandom = isFandom(fandom)
    return wrapOr(fic => isThisFandom(fic) || isThatFandom(fic))
  }
  isThisFandom.and = fandom => {
    const isThatFandom = isFandom(fandom)
    return wrapOr(fic => isThisFandom(fic) && isThatFandom(fic))
  }
  return isThisFandom
}