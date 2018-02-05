const serverRouter = require('server-router')
const r2 = require('r2')
const http = require('http')
const url = require('url')
const querystring = require('querystring')
const clients = require('./clients.json')

const router = serverRouter()

router.route('GET', '/api/request', async (req, res) => {
  const input = querystring.parse(url.parse(req.url).query).input
  const client = clients.find(c => c.accepts.includes(input))
  let response
  if (!client) {
    response = `Sorry, I don't understand.`
  } else {
    response = await r2(`http://${client.url}?input=${input}`).text
  }
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify({
    text: response
  }))
})

http.createServer(router.start()).listen(3030)
