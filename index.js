const serverRouter = require('server-router')
const http = require('http')

const router = serverRouter()

router.route('GET', '/api/request', (req, res) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify({
    text: 'Test API return'
  }))
})

http.createServer(router.start()).listen(3030)
