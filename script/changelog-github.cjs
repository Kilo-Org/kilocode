// kilocode_change - new file
// Custom changelog generator that wraps @changesets/changelog-github
// but strips "Thanks @user!" for team members.
const github = require("@changesets/changelog-github")

const team = new Set([
  "actions-user",
  "kilo-maintainer[bot]",
  "kiloconnect[bot]",
  "kiloconnect-lite[bot]",
  "alexkgold",
  "arimesser",
  "arkadiykondrashov",
  "bturcotte520",
  "catrielmuller",
  "chrarnoldus",
  "codingelves",
  "darkogj",
  "dependabot[bot]",
  "dosire",
  "DScdng",
  "emilieschario",
  "eshurakov",
  "Helix-Kilo",
  "iscekic",
  "jeanduplessis",
  "jobrietbergen",
  "jrf0110",
  "kevinvandijk",
  "alex-alecu",
  "imanolmzd-svg",
  "kilocode-bot",
  "kilo-code-bot",
  "kilo-code-bot[bot]",
  "kirillk",
  "lambertjosh",
  "LigiaZ",
  "marius-kilocode",
  "markijbema",
  "olearycrew",
  "pandemicsyn",
  "pedroheyerdahl",
  "RSO",
  "sbreitenother",
  "suhailkc2025",
  "Sureshkumars",
])

const base = github.default || github

module.exports = {
  ...base,
  getReleaseLine: async (changeset, type, options) => {
    const line = await base.getReleaseLine(changeset, type, options)
    // Strip "Thanks @user!" for team members
    return line.replace(/ Thanks \[@([^\]]+)\]\([^)]+\)!/g, (match, user) => {
      if (team.has(user)) return ""
      return match
    })
  },
}
