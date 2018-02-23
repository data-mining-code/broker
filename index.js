const serverRouter = require('server-router')
const r2 = require('r2')
const exec = require('execall')
const http = require('http')
const url = require('url')
const querystring = require('querystring')

const router = serverRouter()

const clients = [
  {
    "name": "stock",
    "regex": /(?:is(?: there)?|do we have) (\S+) in stock(?: at (\w+))?/i,
    "arguments": [
      {
        "name": "product",
        "index": 0
      },
      {
        "name": "location",
        "index": 1,
        "optional": true
      }
    ]
  },
  {
    "name": "notfound",
    "regex": /.*/
  }
]

router.route('GET', '/api/request', async (req, res) => {
  const input = querystring.parse(url.parse(req.url).query).input
  const client = clients.find(c => c.regex.test(input))
  let qs = `?client=${client.name}`
  const result = exec(client.regex, input)
  if (client.arguments) {
    client.arguments.forEach(arg => {
      if (!arg.optional && result[0].sub[arg.index] !== undefined) {
        qs = qs.concat(`&${arg.name}=${result[0].sub[arg.index]}`)
      }
    })
  }

  let response
  if (client.name === 'notfound') {
    response = `Sorry, I don't understand.`
  } else {
    response = await r2(`http://pythontest${qs}`).text
  }
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify({text}))
})

http.createServer(router.start()).listen(3030)
