const serverRouter = require('server-router')
const r2 = require('r2')
const exec = require('execall')
const firebase = require('firebase')
const http = require('http')
const url = require('url')
const querystring = require('querystring')

const router = serverRouter()

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
}
firebase.initializeApp(config)
const database = firebase.database()

const clients = [
  {
    "name": "stock",
    "regex": /(?:is(?: there)?|do we have) ([\s\S]+) in stock(?: at (\w+))?/i,
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
  const timestamp = Date.now()
  const input = querystring.parse(url.parse(req.url).query).input
  const client = clients.find(c => c.regex.test(input))
  let qs = `?client=${client.name}`
  const result = exec(client.regex, input)
  let args = {}
  if (client.arguments) {
    client.arguments.forEach(arg => {
      if (!arg.optional && result[0].sub[arg.index] !== undefined) {
        qs = qs.concat(`&${arg.name}=${result[0].sub[arg.index]}`)
        args[arg.name] = result[0].sub[arg.index]
      }
    })
  }
  const obj = {
    text: input,
    query: {
      client: client.name,
      ...args
    }
  }
  database.ref(`logs/${timestamp}/request`).set(obj)

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
  database.ref(`logs/${timestamp}/response`).set({
    text: response
  })
  res.end(JSON.stringify({text}))
})

http.createServer(router.start()).listen(3030)
